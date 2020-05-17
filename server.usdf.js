let argv = require('yargs')
	.usage('Usage: $0 [usdf-resources] --output [output-directory]')
	.example(
		'$0 usdf-FormularyDrug --output .',
		'generates swagger definitions for usdf-FormularyDrug resource and store in the output directory specified'
	)
	.alias('o', 'output')
	.nargs('o', 1)
	.describe('o', 'Output directory')
	.help('h')
	.alias('h', 'help').argv;

const fs = require('fs');
const moment = require('moment-timezone');
const path = require('path');
const winston = require('winston');
const beautify = require('json-beautify');

const { JSONPath } = require('jsonpath-plus');
const { appendOperationOutcomeAndBundle } = require('./utils/utils');

let args = {};
args.resources = argv._;
args.output = argv.output || path.join(__dirname, '/outputs');

if (!args.resources && args.resources.length > 0) {
	logger.error(`No Resource defined.
Please use the following pattern to invoke the tool

fhir-to-swagger--usdf <ResourceName> <OutputDirectory>
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

let _jPath = '$.definitions.';

/**
 * method to generate swagger definitions for the defined the FHIR resources
 *
 * @param {string} _resource FHIR resource keyword
 */
function generate(_resource) {
	logger.info('Starting to generate Swagger definition for FHIR resource = ' + _resource);

	let usdfResource;
	try {
		usdfResource = JSON.parse(
			fs.readFileSync(
				path.join(__dirname, `/schemas/Davinci-drug-formulary/StructureDefinition-${_resource}.json`)
			)
		);
	} catch (err) {
		logger.error(
			`No USDF FHIR Resource Found for ${_resource}
`,
			err
		);
		return 0;
	}

	let fhirResource = JSONPath({
		path: `${_jPath}${usdfResource['type']}`,
		json: fhirSchemaJSON,
	})[0];

	if (!fhirResource) {
		return 0;
	}

	// swagger json schema
	let swaggerJSON = {
		swagger: '2.0',
		definitions: {},
		host: 'hapi.fhir.org',
		basePath: '/',
		info: {
			title: `${_resource}FHIRAPI`,
			version: usdfResource['version'],
			description: usdfResource['description'],
		},
		paths: {},
	};
	swaggerJSON.definitions[usdfResource['type']] = {} = fhirResource;

	let props = JSONPath({
		path: '$.properties',
		json: fhirResource,
	})[0];
	let tags = [];

	Object.keys(props).forEach((k) => {
		buildResourceDef(usdfResource['type'], k, props, tags, swaggerJSON);
	});

	appendOperationOutcomeAndBundle(swaggerJSON);
	[0, 1, 2].forEach(() => {
		traverseElements(props, tags, swaggerJSON);
	});

	buildPaths(_resource, swaggerJSON, usdfResource);
	buildSecurityDefinitions(swaggerJSON);

	// write outputt json file
	fs.writeFileSync(`${_resource.toLowerCase()}-output.json`, beautify(swaggerJSON, null, 4), (err) => {
		if (err) {
			logger.error(err);
		}
	});
}

/**
 *
 * @param {{}} node resource node
 * @param {string} key keyword
 * @param {{}} _props properties
 * @param {[string]} _tags tags
 * @param {{}} _swagger swagger JSON
 */
function buildResourceDef(node, key, _props, _tags, _swagger) {
	// remove const elements from the resource-type and append ttype element with string,
	// since this is not supported by the swagger definitions
	if (key === 'resourceType') {
		delete _props[key]['const'];
		_props[key].type = 'string';
	}

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

	// check for Extension object and check $ref in properties to eleminate complex references
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

	let tempElem = JSONPath({
		path: `${_jPath}${elemTag}`,
		json: fhirSchemaJSON,
	})[0];

	// delete description element if any $ref as sibling elements
	if (tempElem['$ref']) delete tempElem['description'];

	// add string type to xhtml elements
	if (elemTag === 'xhtml') tempElem.type = 'string';

	_swagger.definitions[elemTag] = {} = tempElem;
}

/**
 * method to generate security definitions for swagger resources
 *
 * @param {{}} _swagger swagger JSON
 */
function buildSecurityDefinitions(_swagger) {
	let securityDefinitions = {
		Bearer: {
			name: 'Authorization',
			in: 'header',
			type: 'apiKey',
			description: "Authorization header using the Bearer scheme. Example :: 'Authorization: Bearer {token}'",
		},
	};
	let security = [
		{
			Bearer: [],
		},
	];

	_swagger.securityDefinitions = securityDefinitions;
	_swagger.security = security;
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
 * @param {string} _key keywrod
 * @param {{}} _swagger swagger JSON
 * @param {{}} _definition
 */
function buildPaths(_key, _swagger, _definition) {
	// #region produces section

	let produces = [
		'text/plain',
		'application/json',
		'application/fhir+json',
		'application/json+fhir',
		'text/json',
		'application/xml',
		'application/fhir+xml',
		'application/xml+fhir',
		'text/xml',
		'text/xml+fhir',
		'application/octet-stream',
	];
	_swagger.produces = produces;

	// #endregion

	let path = `/${_definition['type']}`;
	_swagger.paths[path] = {};

	let get = {
		tags: [_definition['name']],
		summary: `Get ${_key}`,
		parameters: buildSearchParameters(_definition['type'], _definition),
		response: getResponse(_definition['type']),
	};
	_swagger.paths[path]['get'] = get;
}

/**
 * method to populate search parameters for the defined USDF resource
 * resources based on the search-parameters.json schema
 *
 * @param {string} elem
 * @param {{}} _definition
 */
function buildSearchParameters(elem, _definition) {
	let searchParamJSON = JSON.parse(fs.readFileSync(path.join(__dirname, 'schemas/search-parameters.json')));
	let entries = JSONPath({ path: '$.entry.*', json: searchParamJSON });
	let queryParams = [];

	Object.keys(entries).forEach((k) => {
		let entry = entries[k]['resource'];

		// append search param _profile without any chaining
		if (entry['name'] === '_profile') {
			queryParams.push({
				name: entry['name'],
				in: 'query',
				required: true,
				type: 'string',
				descriptioon: entry['description'],
				default: _definition['url'],
			});
		}
	});

	return queryParams.concat(buildSpecificSearchParameters(elem, _definition));
}

/**
 * method to populate search parameters specific to the USDF resource
 *
 * @param {string} elem element
 * @param {{}} _definition
 */
function buildSpecificSearchParameters(elem, _definition) {
	let schemaDir = path.join(__dirname, 'schemas/Davinci-drug-formulary');
	let schemas = fs.readdirSync(schemaDir).filter((f) => {
		return f.includes('SearchParameter-');
	});

	let queryParams = [];
	for (var i = 0; i < schemas.length; ) {
		let entry = JSON.parse(fs.readFileSync(path.join(schemaDir, schemas[i])));
		if (entry['base'].includes(elem)) {
			queryParams.push({
				name: entry['name'],
				in: 'query',
				type: 'string',
				description: entry['description'],
			});
		}
		i++;
	}

	return queryParams;
}

function getResponse(success) {
	return {
		200: getSuccessResponse(success),
	};
}

function getSuccessResponse(element) {
	let success = {
		description: 'Success',
	};

	if (element) {
		success['schema'] = {
			$ref: `#/definitions/${element}`,
		};
	}

	return success;
}

logger.info(`-------------------------- Starting FHIR to Swagger USDF --------------------------`);

args.resources.forEach((k) => {
	generate(k);
});

logger.info(`-------------------------- Finish Processing --------------------------`);
