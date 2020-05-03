const fs = require('fs');
const path = require('path');
const { JSONPath } = require('jsonpath-plus');
const { appendOperationOutcomeAndBundle } = require('./utils/utils');

// the keyword used to generate the swagger | usdf-CoveragePlan or usdf-FormularyDrug
var keyword = 'usdf-FormularyDrug';

let fhirSchema = fs.readFileSync(path.join(__dirname, '/schemas/fhir.schema.json'));
let fhirSchemaJSON = JSON.parse(fhirSchema);

let _jPath = '$.definitions.';

async function generate(_resource) {
	console.log('Starting to generate Swagger defintions for FHIR Davinci Resource = ' + _resource);

	let fhirResource;
	try {
		fhirResource = JSON.parse(
			await fs.readFileSync(
				path.join(__dirname, `/schemas/Davinci-drug-formulary/StructureDefinition-${_resource}.json`)
			)
		);
		console.log('Mentioned FHIR Resource exist');
	} catch (err) {
		console.error(`No FHIR resource found for ${_resource}`, err);
		return 0;
	}

	let subResource = JSONPath({
		path: `${_jPath}${fhirResource['type']}`,
		json: fhirSchemaJSON,
	})[0];

	let swaggerJSON = {
		swagger: '2.0',
		definitions: {},
		host: 'hapi.fhir.org',
		basePath: '/',
		info: {
			title: `${_resource}FHIRAPI`,
			version: fhirResource['version'],
			description: fhirResource['description'],
		},
		paths: {},
	};
	swaggerJSON.definitions[fhirResource['type']] = {} = subResource;

	let props = JSONPath({
		path: '$.definitions.' + fhirResource['type'] + '.properties',
		json: fhirSchemaJSON,
	})[0];
	let tags = [];
	Object.keys(props).forEach((k) => {
		buildResourceDef(fhirResource['type'], k, props, tags, swaggerJSON);
	});

	appendOperationOutcomeAndBundle(swaggerJSON);
	[0, 1, 2].forEach(() => {
		traverseElements(props, tags, swaggerJSON);
	});

	await buildPaths(_resource, fhirResource, swaggerJSON);

	fs.writeFileSync(`${_resource.toLowerCase()}-output.json`, JSON.stringify(swaggerJSON), (err) => {
		if (err) {
			logger.error(err);
		}
	});
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

async function buildPaths(_key, _definition, _swagger) {
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

	let path = `/${_definition['type']}`;
	_swagger.paths[path] = {};

	let get = {
		tags: [_definition['name']],
		summary: `Get ${_key}`,
		parameters: await buildSearchParameters(_definition['type'], _definition),
		responses: getResponse(_definition['type']),
	};
	_swagger.paths[path]['get'] = get;
}

async function buildSearchParameters(elem, _definition) {
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
				description: entry['description'],
				default: _definition['url'],
			});
		}

		// * append search params of ref without any chaining | additional search parameters
		// if (entry['base'].includes(elem)) {
		// 	queryParams.push({
		// 		name: entry['name'],
		// 		in: 'query',
		// 		type: 'string',
		// 		description: entry['description'],
		// 	});
		// }
	});

	// let newParams = await buildSpecificSearchParameters(elem, _definition);
	return queryParams.concat(await buildSpecificSearchParameters(elem, _definition));
}

async function buildSpecificSearchParameters(elem, _definition) {
	let schemaDir = path.join(__dirname, '/schemas/Davinci-drug-formulary');
	let schemas = fs.readdirSync(schemaDir).filter((f) => {
		return f.includes('SearchParameter-');
	});

	let queryParams = [];
	for (var i = 0; i < schemas.length; ) {
		let entry = JSON.parse(await fs.readFileSync(path.join(schemaDir, schemas[i])));
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

generate(keyword);
