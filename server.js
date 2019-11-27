let argv = require('yargs')
	.usage('Usage: $0 [fhir-resources] --combine --output [output-directory]')
	.command('count', 'Count the lines in a file')
	.example(
		'$0 Coverage ClaimResponse --output .',
		'generates swagger definitions for Coverage and ClaimResponse resources and store in the output directory specified'
	)
	.example(
		'$0 Coverage ClaimResponse --combine --output .',
		'generates a combined swagger definition for Coverage and ClaimResponse resources and store in the output directory specified'
	)
	.alias('c', 'combine')
	.nargs('c', 0)
	.describe('c', 'Merge and combine all generated Swagger as one')
	.alias('o', 'output')
	.nargs('o', 1)
	.describe('o', 'Output directory')
	.help('h')
	.alias('h', 'help').argv;

const fs = require('fs');
const moment = require('moment-timezone');
const path = require('path');
const winston = require('winston');
const swaggermerge = require('swagger-merge');

const { JSONPath } = require('jsonpath-plus');
const { appendOperationOutcomeAndBundle, buildResourceChaining, getResponse, snakeToCamel } = require('./utils/utils');

let args = {};
args.resources = argv._;
args.output = argv.output || path.join(__dirname, '/outputs');
args.combine = argv.combine;

if (!args.resources && args.resources.length > 0) {
	logger.error(`No Resource defined.
Please use the following pattern to invoke the tool

fhir-to-swagger <ResourceName> <OutputDirectory>
`);
	return 0;
}

// #region winston logger configurations

/*
 *
 * specified winston logger format will contain the following pattern
 * LEVEL :: MESSAGE
 *
 * NOTE: haven't appended the time since this is executed at the client side
 *
 * two log files will be created at the time of execution
 * 1. fhir-to-swagger-error.log : only contains the error logs of the server
 * 2. fhir-to-swagger.log : contains both error and other levels of logs
 *
 */

const appendTimestamp = winston.format((info, opts) => {
	info.timestamp = moment().format();
	return info;
});

const loggerFormat = winston.format.printf((info) => {
	return `${info.timestamp} ${info.level.toUpperCase()} :: ${info.message}`;
});

const logger = winston.createLogger({
	format: winston.format.combine(appendTimestamp({}), loggerFormat),
	transports: [
		new winston.transports.File({
			filename: path.join(__dirname, '/repository/logs', 'fhir-to-swagger-error.log'),
			level: 'error',
		}),
		new winston.transports.File({
			filename: path.join(__dirname, '/repository/logs', 'fhir-to-swagger.log'),
			level: 'debug',
		}),
		new winston.transports.Console({ level: 'debug' }),
	],
	exitOnError: false,
});

// #endregion

let fhirSchema = fs.readFileSync(path.join(__dirname, '/schemas/fhir.schema.json'));
let fhirSchemaJSON = JSON.parse(fhirSchema);

let kw_OpOut = 'OperationOutcome',
	kw_Bundle = 'Bundle';
let _jPath = '$.definitions.';

let swaggerStore = [];

/**
 * method to generate swagger definitions for the defined the FHIR resources
 *
 * @param {any} _resource FHIR resource keyword
 */
function generate(_resource) {
	logger.info('Starting to generate Swagger definition for FHIR resource = ' + _resource);
	// extract resource model FHIR schema
	let fhirResource = JSONPath({
		path: `${_jPath}${_resource}`,
		json: fhirSchemaJSON,
	})[0];

	if (!fhirResource) {
		logger.error(`No FHIR resource found for ${_resource}`);
		return 0;
	}

	// swagger json schema
	let swaggerJSON = {
		swagger: '2.0',
		definitions: {},
		host: 'hapi.fhir.org',
		basePath: `/${_resource.toLowerCase()}-api`,
		info: {
			title: `${_resource}FHIRAPI`,
			version: fhirSchemaJSON['id'].substring(
				fhirSchemaJSON['id'].lastIndexOf('/') + 1,
				fhirSchemaJSON['id'].length
			),
			description: fhirResource['description'],
		},
		paths: {},
	};
	swaggerJSON.definitions[_resource] = {} = fhirResource;

	let props = JSONPath({
		path: '$.properties',
		json: fhirResource,
	})[0];
	let tags = [];

	Object.keys(props).forEach((k) => {
		buildResourceDef(_resource, k, props, tags, swaggerJSON);
	});

	appendOperationOutcomeAndBundle(swaggerJSON);
	[0, 1, 2].forEach(() => {
		traverseElements(props, tags, swaggerJSON);
	});

	buildPaths(_resource, swaggerJSON);

	logger.info('Writing Swagger definition for FHIR resource = ' + _resource);

	// store the swagger JSON generated for FHIR resources to combine them
	if (args.combine) swaggerStore.push(swaggerJSON);

	// write output json file
	fs.writeFileSync(`${args.output}/${_resource.toLowerCase()}-output.json`, JSON.stringify(swaggerJSON), (err) => {
		if (err) {
			logger.error(err);
		}
	});
}

/**
 * method to generate and populate resource definitions
 *
 * @param {any} node resource node
 * @param {any} key keyword
 * @param {any} _props properties
 * @param {any} _tags tags
 * @param {any} _swagger swagger JSON
 */
function buildResourceDef(node, key, _props, _tags, _swagger) {
	// remove const elements from the resource-type and append type element with string,
	// since this is not supported by the swagger definitions
	if (key === 'resourceType') {
		delete _props[key]['const'];
		_props[key].type = 'string';
	}

	// remove extensions
	// if (key.toLowerCase().endsWith('extension') || key.toLowerCase().endsWith('contained')) {
	//     delete _props[key];
	//     return;
	// }

	// remove contained elements
	if (key.toLowerCase().endsWith('contained')) {
		delete _props[key];
		return;
	}

	// if key starts with _ remove the property and return
	if (key.startsWith('_')) {
		delete _swagger.definitions[node].properties[key];
		return;
	}

	// check for Extension object and check $ref in properties to eliminate complex references
	if (node === 'Extension' && key.startsWith('value')) {
		let n = _props[key];
		let ref = n['$ref'];

		// delete complex reference if it is not pre-defined already
		// (patch with string type if not exists)
		if (
			ref &&
			!['string', 'number', 'boolean'].concat(_tags).includes(ref.substring(ref.lastIndexOf('/') + 1, ref.length))
		) {
			_swagger.definitions[node].properties[key].type = 'string';
			delete _swagger.definitions[node].properties[key]['$ref'];
		}
	}

	// retrieve a property object and check for $ref element
	let n = _props[key];
	let ref = null;

	if (n['items']) ref = n['items']['$ref'];
	else ref = n['$ref'];

	// if no $ref tags return the loop
	if (!ref) return;

	// extract the $ref tag element and split the values with the lastIndexOf '/' to
	// get the referred element node and do a JSON Path retrieval to extract the referred node
	let elemTag = ref.substring(ref.lastIndexOf('/') + 1, ref.length);
	if (!_tags.includes(elemTag)) _tags.push(elemTag);
	else return;

	let tempElem = JSONPath({ path: `${_jPath}${elemTag}`, json: fhirSchemaJSON })[0];

	// delete description element if any $ref as sibling elements
	if (tempElem['$ref']) delete tempElem['description'];

	// add string type to xhtml elements
	if (elemTag === 'xhtml') tempElem.type = 'string';

	_swagger.definitions[elemTag] = {} = tempElem;
}

/**
 * method to traverse through the elements
 *
 * @param {any} _props properties
 * @param {any} _tags tags
 * @param {any} _swagger swagger JSON
 */
function traverseElements(_props, _tags, _swagger) {
	_tags.forEach((e) => {
		let elem = JSONPath({ path: _jPath + e, json: fhirSchemaJSON })[0];
		_props = JSONPath({ path: '$.properties', json: elem })[0];

		if (!_props) return;

		Object.keys(_props).forEach((k) => {
			buildResourceDef(e, k, _props, _tags, _swagger);
		});
	});
}

/**
 * method to build and generate resource paths
 *
 * @param {any} _key keywrod
 * @param {any} _swagger swagger JSON
 */
function buildPaths(_key, _swagger) {
	// #region produces section

	let produces = ['application/json', 'application/xml', 'application/fhir+xml', 'application/fhir+json'];
	_swagger.produces = produces;

	// #endregion

	// #region / path

	let path = `/${_key}`;
	_swagger.paths[path] = {};

	let post = {
		tags: [_key],
		parameters: [
			{
				name: 'body',
				in: 'body',
				schema: {
					$ref: `#/definitions/${_key}`,
				},
			},
		],
		responses: getResponse(_key, kw_OpOut, kw_OpOut),
	};
	_swagger.paths[path]['post'] = post;

	let get = {
		tags: [_key],
		parameters: buildSearchParameters(_key),
		responses: getResponse(kw_Bundle, kw_OpOut, kw_OpOut),
	};
	_swagger.paths[path]['get'] = get;

	// #endregion

	// #region /Resource/{id} path

	path = `/${_key}/{id}`;
	_swagger.paths[path] = {};

	let parameters = [
		{
			name: 'id',
			in: 'path',
			type: 'string',
			required: true,
		},
	];
	_swagger.paths[path]['parameters'] = {} = parameters;

	get = {
		tags: [_key],
		parameters: [],
		responses: getResponse(_key, kw_OpOut, kw_OpOut),
	};
	_swagger.paths[path]['get'] = get;

	let put = {
		tags: [_key],
		parameters: [
			{
				name: 'body',
				in: 'body',
				schema: {
					$ref: `#/definitions/${_key}`,
				},
			},
		],
		responses: getResponse(_key, kw_OpOut, kw_OpOut),
	};
	_swagger.paths[path]['put'] = put;

	let del = {
		tags: [_key],
		parameters: [],
		responses: getResponse(kw_OpOut, kw_OpOut, kw_OpOut),
	};
	_swagger.paths[path]['delete'] = del;

	// #endregion

	// #region /Resource/_history path

	path = `/${_key}/_history`;
	_swagger.paths[path] = {};

	let historyParams = [
		{
			name: '_since',
			in: 'query',
			type: 'string',
		},
		{
			name: '_count',
			in: 'query',
			type: 'string',
		},
	];

	get = {
		tags: [_key],
		parameters: historyParams,
		responses: getResponse(kw_Bundle, kw_OpOut, kw_OpOut),
	};
	_swagger.paths[path]['get'] = {} = get;

	// #endregion

	// #region /Resource/{id}/_history path

	path = `/${_key}/{id}/_history`;
	_swagger.paths[path] = {};

	get = {
		tags: [_key],
		parameters: [
			{
				name: 'id',
				in: 'path',
				type: 'string',
				required: true,
			},
		].concat(historyParams),
		responses: getResponse(kw_Bundle, kw_OpOut, kw_OpOut),
	};
	_swagger.paths[path]['get'] = {} = get;

	// #endregion

	// #region /Resource/{id}/_history/{vid} path

	path = `/${_key}/{id}/_history/{vid}`;
	_swagger.paths[path] = {};

	get = {
		tags: [_key],
		parameters: [
			{
				name: 'id',
				in: 'path',
				type: 'string',
				required: true,
			},
			{
				name: 'vid',
				in: 'path',
				type: 'string',
				required: true,
			},
		],
		responses: getResponse(_key, kw_OpOut, kw_OpOut),
	};
	_swagger.paths[path]['get'] = {} = get;

	// #endregion
}

/**
 * method to populate search parameters for the defined FHIR
 * resources based on the search-parameters.json schema
 *
 * @param {any} elem element
 */
function buildSearchParameters(elem) {
	let searchParamJSON = JSON.parse(fs.readFileSync(path.join(__dirname, '/schemas/search-parameters.json')));
	let entries = JSONPath({ path: '$.entry.*', json: searchParamJSON });
	let queryParams = [];

	Object.keys(entries).forEach((k) => {
		let entry = entries[k]['resource'];

		// append search params of ref without any chaining
		if (entry['base'].includes(elem) || entry['name'].startsWith('_'))
			queryParams.push({
				name: entry['name'],
				in: 'query',
				type: 'string',
				description: entry['description'],
			});

		// resource chaining implementation
		if (entry['base'].includes[elem] && entry['type'] === 'reference') {
			let target = ([] = entry['target']);
			if (!target) return;

			target.forEach((t) => {
				let name = `${snakeToCamel(entry['name'])}:${t}`;
				buildResourceChaining(queryParams, entries, t, name);
			});
		}
	});

	// * extra common query parameters
	// queryParams.push({
	// 	name: '_format',
	// 	in: 'query',
	// 	type: 'string',
	// 	description:
	// 		'Format parameter can use to get response by setting _fromat param value  from xml by _format=xml and response from json by _format=json',
	// 	'x-consoleDefault': "application/json"
	// }, {
	// 	name: '_language',
	// 	in: 'query',
	// 	type: 'string',
	// 	description: 'The language of the resource'
	// });

	return queryParams;
}

/**
 * method to merge multiple swagger definitions generated for
 * multiple FHIR resources
 */
function mergeSwagger() {
	logger.info(`Starting to merge Swagger definitions of ${args.resources.join(' ')}`);

	let info = {
		title: `${args.resources.join('-')}--FHIRAPI`,
		version: `1.0.0`,
		description: `Swagger for FHIR Resources ${args.resources.join(', ')}`,
	};

	let host = 'hapi.fhir.org';
	let schemas = ['http', 'https'];
	let basePath = '/';

	let merged = swaggermerge.merge(swaggerStore, info, basePath, host, schemas);

	logger.info(`Writing Swagger definition for the combined FHIR resources`);

	fs.writeFileSync(`${args.output}/combined-swagger--output.json`, JSON.stringify(merged), (err) => {
		if (err) {
			logger.error(err);
		}
	});
}

logger.info(`-------------------------- Starting FHIR to Swagger --------------------------`);

args.resources.forEach((k) => {
	generate(k);
});

if (args.combine) mergeSwagger();

logger.info(`-------------------------- Finish Processing --------------------------`);
