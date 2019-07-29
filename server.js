const fs = require('fs');
const jsonPath = require('jsonpath-plus');
const {
	snakeToCamel,
	appendOperationOutcomeAndBundle,
	getResponse,
	buildResourceChaining
} = require('./utils/utils');
const { JSONPath } = jsonPath;

let args = require('yargs').argv;
args = JSON.parse(JSON.stringify(args));
args.resource = args._[0];
args.outputFolder = args._[1] || `./outputs`;

// * reads the fhir.schema.json file parses as json element
let schemaFile = fs.readFileSync('./schemas/fhir.schema.json');
let schemaJson = JSON.parse(schemaFile);
let outputJson = {};

if (!args.resource) {
	console.warn('WARN :: No Resource defined.\nPlease use the following pattern to invoke the tool\n\nfhir-to-swagger <ResourceName> <OutputDirectory>\n');
	return 0;
}

// resource keyword from argument
let keyword = args.resource;

let opOutcomeKeyword = 'OperationOutcome';
let bundleKeyword = 'Bundle';
let jPath = '$.definitions.';

// * extracts the resource model from schema
let resourceNode = JSONPath({
	path: `${jPath}${keyword}`,
	json: schemaJson
})[0];

if (!resourceNode) {
	console.error('ERROR :: No Resource found for ' + keyword);
	return 0;
}

// building output.json for the resource
outputJson.swagger = '2.0';
outputJson.definitions = {};

outputJson.host = 'hapi.fhir.org';
outputJson.basePath = `/${keyword.toLowerCase()}-api`;
outputJson.info = {
	title: `${keyword}FHIRAPI`,
	version: schemaJson['id'].substring(
		schemaJson['id'].lastIndexOf('/') + 1,
		schemaJson['id'].length
	)
};
outputJson.paths = {};

// * assign the resource node to relevant key
outputJson.definitions[keyword] = {} = resourceNode;
outputJson.info['description'] = resourceNode['description'];

// extract properties section of the resource model
let properties = JSONPath({ path: '$.properties', json: resourceNode })[0];
let tagArray = [];

// traverse through properties object using key value pairs
Object.keys(properties).forEach((key) => {
    buildDefinition(keyword, key);
});

appendOperationOutcomeAndBundle(outputJson);

// FIXME: change the implementation
// traverse through elements and build definitions
[0,1,2].forEach(() => {
    traverseElement();
});

buildPaths();

function buildDefinition(obj, key) {

    // * resourceType const element is not supported. remove that element & append type 
    if (key === 'resourceType') {
        delete properties[key]['const'];
        properties[key].type = 'string';
    }

    // to delete extension elements
    // if (key.toLowerCase().endsWith('extension') || key.toLowerCase().endsWith('contained')) {
    //     delete properties[key];
    //     return;
	// }
	
	// not deleting extension element
    if (key.toLowerCase().endsWith('contained')) {
        delete properties[key];
        return;
    }

    // if key starts with _ character then return
    if (key.startsWith('_')) {
        delete outputJson.definitions[obj].properties[key];
        return;
	}

	// checks for Extension object and check $ref in properties to eliminate complex reference
	if (obj === 'Extension' && key.startsWith('value')) {
		let n = properties[key];
		let ref = n['$ref'];

		// delete complex reference if it is not predefined already (patch with string type if not exists)
		if (ref && !['string', 'number', 'boolean'].concat(tagArray).includes(ref.substring(ref.lastIndexOf('/') + 1, ref.length))) {
			outputJson.definitions[obj].properties[key].type = 'string';
			delete outputJson.definitions[obj].properties[key]['$ref'];
		}
	}

    // retrieve a property object and check for $ref element
    let node = properties[key];
    let reference = null;
    if (node['items']) {
        reference = node['items']['$ref'];
    } else {
        reference = node['$ref'];
    }

    // if no $ref tags return the loop;
    if (!reference) { return; }
    
    /**
     * extract the $ref tag element and split the value with the lastIndexOf '/' to 
     * get the refered element node and do a jsonpath retrieval to extract the refered node
     */
    let elementTag = reference.substring(
		reference.lastIndexOf('/') + 1,
		reference.length
	);
    if (!tagArray.includes(elementTag)) {
        tagArray.push(elementTag);
    } else {
        return;
    }
    let tempElement = JSONPath({
		path: `${jPath}${elementTag}`,
		json: schemaJson
	})[0];

    // * delete description element if any $ref as sibling element
    if(tempElement['$ref']) {
		delete tempElement['description'];
	}
	
	// * adding string type to xhtml element
	if (elementTag === 'xhtml') {
		tempElement.type = 'string';
	}

    outputJson.definitions[elementTag] = {} = tempElement;
}

function traverseElement() {
    tagArray.forEach((e) => {
        let element = JSONPath({
			path: jPath + e,
			json: schemaJson
		})[0];
        properties = JSONPath({ path: '$.properties', json: element })[0];
        
        if (!properties) { return; }

        Object.keys(properties).forEach((key) => {
            buildDefinition(e, key);
        });
    });
}

function buildPaths() {

	//#region produces section
	let produces = [
		"application/json",
		"application/xml",
		"application/fhir+xml",
		"application/fhir+json"
	];
	outputJson.produces = produces;
	//#endregion

    //#region / path
    let path = `/${keyword}`;
    outputJson.paths[path] = {};

    let post = {
		tags: [keyword],
		parameters: [
			{
				name: 'body',
				in: 'body',
				schema: {
					$ref: `#/definitions/${keyword}`
				}
			}
		],
		responses: getResponse(keyword,opOutcomeKeyword,opOutcomeKeyword)
	};
    outputJson.paths[path]['post'] = post;

    let get = {
		tags: [keyword],
		parameters: buildSearchParameters(keyword),
		responses: getResponse(bundleKeyword,opOutcomeKeyword,opOutcomeKeyword)
	};
    outputJson.paths[path]['get'] = get;
    //#endregion 


    //#region /Resource/{id} path
    path = `/${keyword}/{id}`;
    outputJson.paths[path] = {};

    let parameters = [
		{
			name: 'id',
			in: 'path',
			type: 'string',
			required: true
		}
	];
    outputJson.paths[path]['parameters'] = {} = parameters;

    get = {
		tags: [keyword],
		parameters: [],
		responses: getResponse(keyword, opOutcomeKeyword, opOutcomeKeyword)
	};
    outputJson.paths[path]['get'] = get;

    let put = {
		tags: [keyword],
		parameters: [
			{
				name: 'body',
				in: 'body',
				schema: {
					$ref: `#/definitions/${keyword}`
				}
			}
		],
		responses: getResponse(keyword, opOutcomeKeyword, opOutcomeKeyword)
	};
    outputJson.paths[path]['put'] = put;

    let del = {
		tags: [keyword],
		parameters: [],
		responses: getResponse(
			opOutcomeKeyword,
			opOutcomeKeyword,
			opOutcomeKeyword
		)
	};
    outputJson.paths[path]['delete'] = del;
    //#endregion

    //#region /Resource/_history path
    path = `/${keyword}/_history`;
	outputJson.paths[path] = {};
	
	let historyParameters = [
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
		tags: [keyword],
		parameters: historyParameters,
		responses: getResponse(
			bundleKeyword,
			opOutcomeKeyword,
			opOutcomeKeyword
		)
	};
    outputJson.paths[path]['get'] = {} = get;
    //#endregion

    //#region /Resource/{id}/_history path
    path = `/${keyword}/{id}/_history`;
    outputJson.paths[path] = {};

    get = {
		tags: [keyword],
		parameters: [
			{
				name: 'id',
				in: 'path',
				type: 'string',
				required: true
			}
		].concat(historyParameters),
		responses: getResponse(bundleKeyword,opOutcomeKeyword,opOutcomeKeyword)
	};

    outputJson.paths[path]['get'] = {} = get;
    //#endregion

    //#region /Resource/{id}/_history/{vid} path
    path = `/${keyword}/{id}/_history/{vid}`;
    outputJson.paths[path] = {};

    get = {
		tags: [keyword],
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
		responses: getResponse(keyword,opOutcomeKeyword,opOutcomeKeyword)
	};
    outputJson.paths[path]['get'] = {} = get;
    //#endregion
}

function buildSearchParameters(element) {

	let searchParamJson = JSON.parse(
		fs.readFileSync('./schemas/search-parameters.json')
	);
	let entries = JSONPath({ path: '$.entry.*', json: searchParamJson });

	let queryParams = [];

	Object.keys(entries).forEach(k => {
		
		let entry = entries[k]['resource'];

		// this will also append search params of ref without any chaining
		// TODO: an extra condition to eliminate the search param with ref without chaining
		if (entry['base'].includes(element) || entry['name'].startsWith('_')) {
			queryParams.push({
				name: entry['name'],
				in: 'query',
				type: 'string',
				description: entry['description']
			});
		}

		// * resource chaining implementation
		if (entry['base'].includes(element) && entry['type'] === 'reference') {
			let target = ([] = entry['target']);
			
			if (!target) {
				return;
			}

			target.forEach(t => {
				let name = `${snakeToCamel(
					entry['name']
				)}:${t}`;
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

// write output json file
fs.writeFileSync(`${args.outputFolder}/${keyword.toLowerCase()}-output.json`, JSON.stringify(outputJson), (err) => {
    if (err) {
        console.error(err);
    }
});

console.log('Finished Processing');