const fs = require('fs');
const moment = require('moment-timezone');
const path = require('path');
const winston = require('winston');

const { JSONPath } = require('jsonpath-plus');
const { appendOperationOutcomeAndBundle, buildResourceChaining, getResponse, snakeToCamel } = require('./utils/utils');

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
			level: 'error'
		}),
		new winston.transports.File({
			filename: path.join(__dirname, '/repository/logs', 'fhir-to-swagger.log'),
			level: 'debug'
		}),
		new winston.transports.Console({ level: 'debug' })
	],
	exitOnError: false
});

// #endregion

let argv = require('yargs').argv;

let args = {};
args.resources = argv._;
args.output = argv.output || path.join(__dirname, '/outputs');

if (!args.resources && args.resources.length > 0) {
	logger.error(`No Resource defined.
Please use the following pattern to invoke the tool

fhir-to-swagger <ResourceName> <OutputDirectory>
`);
	return 0;
}

let fhirSchema = fs.readFileSync(path.join(__dirname, '/schemas/fhir.schema.json'));
let fhirSchemaJSON = JSON.parse(fhirSchema);

let kw_OpOut = 'OperationOutcome',
	kw_Bundle = 'Bundle';
let _jPath = '$.definitions.';

function generate(_resource) {
	// extract resource model FHIR schema
	let fhirResource = JSONPath({
		path: `${-_jPath}${_resource}`,
		json: fhirSchemaJSON
	});

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
			description: fhirResource['description']
		},
		paths: {}
	};
	swaggerJSON.definitions[_resource] = {} = fhirResource;

	let props = JSONPath({
		path: '$.properties',
		json: fhirResource
	})[0];
	let tags = [];

	Object.keys(props).forEach((k) => {
		buildResourceDef(_resource, k, props, tags);
	});

	appendOperationOutcomeAndBundle(swaggerJSON);
	[0, 1, 2].forEach(() => {
		traverseElements(props, tags);
	});

	buildPaths(_resource);

	// write output json file
	fs.writeFileSync(
		`${args.outputFolder}/${_resource.toLowerCase()}-output.json`,
		JSON.stringify(swaggerJSON),
		(err) => {
			if (err) {
				logger.error(err);
			}
		}
	);
}

function buildResourceDef(node, key, _props, _tags) {
	// remove const elements from the resource-type and append type element with string,
	// since this is not supported by the swagger definitions
	if (node === 'resourceType') {
		delete _props[node]['const'];
		_props[node].type = 'string';
	}

	// remove extensions
	// if (node.toLowerCase().endsWith('extension') || node.toLowerCase().endsWith('contained')) {
	//     delete _props[node];
	//     return;
	// }

	// remove contained elements
	if (node.toLowerCase().endsWith('contained')) {
		delete _props[node];
		return;
	}

	// if node starts with _ remove the property and return
	if (node.startsWith('_')) {
		delete swaggerJSON.definitions[key].properties[node];
		return;
	}

	// check for Extension object and check $ref in properties to eliminate complex references
	if (key === 'Extension' && node.startsWith('value')) {
		let n = _props[node];
		let ref = n['$ref'];

		// delete complex reference if it is not pre-defined already
		// (patch with string type if not exists)
		if (
			ref &&
			!['string', 'number', 'boolean'].concat(_tags).includes(ref.substring(ref.lastIndexOf('/') + 1, ref.length))
		) {
			swaggerJSON.definitions[key].properties[node].type = 'string';
			delete swaggerJSON.definitions[key].properties[node]['$ref'];
		}
	}

	// retrieve a property object and check for $ref element
	let n = _props[node];
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

	swaggerJSON.definitions[elemTag] = {} = tempElem;
}

function traverseElements(_props, _tags) {
	_tags.forEach((e) => {
		let elem = JSONPath({ path: _jPath + e, json: fhirSchemaJSON })[0];
		_props = JSONPath({ path: '$.properties', json: elem })[0];

		if (!_props) return;

		Object.keys(_props).forEach((k) => {
			buildResourceDef(e, k, _props, _tags);
		});
	});
}

function buildPaths(_key) {
	// #region produces section

	let produces = ['application/json', 'application/xml', 'application/fhir+xml', 'application/fhir+json'];
	swaggerJSON.produces = produces;

	// #endregion

	// #region / path

	let path = `/${_key}`;
	swaggerJSON.paths[path] = {};

	let post = {
		tags: [_key],
		parameters: [
			{
				name: 'body',
				in: 'body',
				schema: {
					$ref: `#/definitions/${_key}`
				}
			}
		],
		responses: getResponse(_key, kw_OpOut, kw_OpOut)
	};
	swaggerJSON.paths[path]['post'] = post;

	let get = {
		tags: [_key],
		parameters: buildSearchParameters(_key),
		responses: getResponse(kw_Bundle, kw_OpOut, kw_OpOut)
	};
	swaggerJSON.paths[path]['get'] = get;

	// #endregion

	// #region /Resource/{id} path

	path = `/${_key}/{id}`;
	swaggerJSON.paths[path] = {};

	let parameters = [
		{
			name: 'id',
			in: 'path',
			type: 'string',
			required: true
		}
	];
	swaggerJSON.paths[path]['parameters'] = {} = parameters;

	get = {
		tags: [_key],
		parameters: [],
		responses: getResponse(_key, kw_OpOut, kw_OpOut)
	};
	swaggerJSON.paths[path]['get'] = get;

	let put = {
		tags: [_key],
		parameters: [
			{
				name: 'body',
				in: 'body',
				schema: {
					$ref: `#/definitions/${_key}`
				}
			}
		],
		responses: getResponse(_key, kw_OpOut, kw_OpOut)
	};
	swaggerJSON.paths[path]['put'] = put;

	let del = {
		tags: [_key],
		parameters: [],
		responses: getResponse(kw_OpOut, kw_OpOut, kw_OpOut)
	};
	swaggerJSON.paths[path]['delete'] = del;

	// #endregion

	// #region /Resource/_history path

	path = `/${_key}/_history`;
	swaggerJSON.paths[path] = {};

	let historyParams = [
		{
			name: '_since',
			in: 'query',
			type: 'string'
		},
		{
			name: '_count',
			in: 'query',
			type: 'string'
		}
	];

	get = {
		tags: [_key],
		parameters: historyParams,
		responses: getResponse(kw_Bundle, kw_OpOut, kw_OpOut)
	};
	swaggerJSON.paths[path]['get'] = {} = get;

	// #endregion

	// #region /Resource/{id}/_history path

	path = `/${_key}/{id}/_history`;
	swaggerJSON.paths[path] = {};

	get = {
		tags: [_key],
		parameters: [
			{
				name: 'id',
				in: 'path',
				type: 'string',
				required: true
			}
		].concat(historyParams),
		responses: getResponse(kw_Bundle, kw_OpOut, kw_OpOut)
	};
	swaggerJSON.paths[path]['get'] = {} = get;

	// #endregion

	// #region /Resource/{id}/_history/{vid} path

	path = `/${_key}/{id}/_history/{vid}`;
	swaggerJSON.paths[path] = {};

	get = {
		tags: [_key],
		parameters: [
			{
				name: 'id',
				in: 'path',
				type: 'string',
				required: true
			},
			{
				name: 'vid',
				in: 'path',
				type: 'string',
				required: true
			}
		],
		responses: getResponse(_key, kw_OpOut, kw_OpOut)
	};
	swaggerJSON.paths[path]['get'] = {} = get;

	// #endregion
}

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
				description: entry['description']
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

logger.info(`-------------------------- Starting FHIR to Swagger --------------------------`);

args.resources.forEach((k) => {
	generate(k);
});

logger.info(`-------------------------- Finish Processing --------------------------`);
