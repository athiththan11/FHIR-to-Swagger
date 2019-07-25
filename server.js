const fs = require('fs');
const jsonPath = require('jsonpath-plus');
const { JSONPath } = jsonPath;

var args = require('yargs').argv;
args = JSON.parse(JSON.stringify(args));
args.resource = args._[0];
args.outputFolder = args._[1] || `./outputs`;

// * reads the fhir.schema.json file parses as json element
var schemaFile = fs.readFileSync('./schemas/fhir.schema.json');
var schemaJson = JSON.parse(schemaFile);
var outputJson = {};

// resource keyword from argument
var keyword = args.resource;

// * extracts the resource model from schema
var resourceNode = JSONPath({
	path: `$.definitions.${keyword}`,
	json: schemaJson
})[0];

// building output.json for the resource
outputJson.swagger = '2.0';
outputJson.definitions = {};

outputJson.host = 'hapi.fhir.org';
outputJson.basePath = `/${keyword.toLowerCase()}-api`;
outputJson.info = { title: `${keyword}FHIRAPI`, version: '1.0' };
outputJson.paths = {};

// * assign the resource node to relevant key
outputJson.definitions[keyword] = {} = resourceNode;

// extract properties section of the resource model
var properties = JSONPath({ path: '$.properties', json: resourceNode })[0];
var tagArray = [];

// traverse through properties object using key value pairs
Object.keys(properties).forEach((key) => {

	// console.debug(key);

    buildDefinition(keyword, key);

    // console.debug(JSON.stringify(outputJson))
	// console.debug('======================================');
});

// buildOperationOutcomeAndBundle();
appendOperationOutcomeAndBundle();

var jPath = '$.definitions.';

// FIXME: change the implementation
// traverse through elements and build definitions
[0,1,2].forEach(() => {
    traverseElement();
});

buildPaths();

function buildDefinition(obj, key) {

    // console.debug('Building Definition : ' + key);

    // * resourceType const element is not supported. remove that element & append type 
    if (key === 'resourceType') {
        delete properties[key]['const'];
        properties[key].type = 'string';
    }

    // CHANGED: delete extension elements
    if (key.toLowerCase().endsWith('extension') || key.toLowerCase().endsWith('contained')) {
        delete properties[key];
        return;
    }

    // if key starts with _ character then return
    if (key.startsWith('_')) {
        delete outputJson.definitions[obj].properties[key];
        return;
	}

    // retrieve a property object and check for $ref element
    var node = properties[key];
    var reference = null;
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
    var elementTag = reference.substring(reference.lastIndexOf('/') + 1, reference.length);
    if (!tagArray.includes(elementTag)) {
        tagArray.push(elementTag);
    } else {
        return;
    }
    var tempElement = JSONPath({ path: `$.definitions.${elementTag}`, json: schemaJson })[0];

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

// * opertaion-outcome & bundle elements are hard-coded to eliminate complexity
function appendOperationOutcomeAndBundle() {

    var operationOutcome = {
		description:
			'A collection of error, warning, or information messages that result from a system action.',
		properties: {
			resourceType: {
				description: 'This is a OperationOutcome resource',
				type: 'string'
			},
			issue: {
				description:
					'An error, warning, or information message that results from a system action.',
				items: {
					description:
						'A collection of error, warning, or information messages that result from a system action.',
					properties: {
						id: {
							description:
								'Unique id for the element within a resource (for internal references). This may be any string value that does not contain spaces.',
							$ref: '#/definitions/string'
						},
						severity: {
							description:
								'Indicates whether the issue indicates a variation from successful processing.',
							enum: [
								'fatal',
								'error',
								'warning',
								'information'
							]
						},
						code: {
							description:
								'Describes the type of the issue. The system that creates an OperationOutcome SHALL choose the most applicable code from the IssueType value set, and may additional provide its own code for the error in the details element.',
							enum: [
								'invalid',
								'structure',
								'required',
								'value',
								'invariant',
								'security',
								'login',
								'unknown',
								'expired',
								'forbidden',
								'suppressed',
								'processing',
								'not-supported',
								'duplicate',
								'multiple-matches',
								'not-found',
								'deleted',
								'too-long',
								'code-invalid',
								'extension',
								'too-costly',
								'business-rule',
								'conflict',
								'transient',
								'lock-error',
								'no-store',
								'exception',
								'timeout',
								'incomplete',
								'throttled',
								'informational'
							]
						},
						details: {
							description:
								'Additional details about the error. This may be a text description of the error or a system code that identifies the error.',
							$ref: '#/definitions/CodeableConcept'
						},
						diagnostics: {
							description:
								'Additional diagnostic information about the issue.',
							$ref: '#/definitions/string'
						},
						location: {
							description:
								'This element is deprecated because it is XML specific. It is replaced by issue.expression, which is format independent, and simpler to parse. \n\nFor resource issues, this will be a simple XPath limited to element names, repetition indicators and the default child accessor that identifies one of the elements in the resource that caused this issue to be raised.  For HTTP errors, will be "http." + the parameter name.',
							items: {
								$ref: '#/definitions/string'
							},
							type: 'array'
						},
						expression: {
							description:
								'A [simple subset of FHIRPath](fhirpath.html#simple) limited to element names, repetition indicators and the default child accessor that identifies one of the elements in the resource that caused this issue to be raised.',
							items: {
								$ref: '#/definitions/string'
							},
							type: 'array'
						}
					},
					additionalProperties: false
				},
				type: 'array'
			}
		},
		additionalProperties: false,
		required: ['issue', 'resourceType']
    };
    outputJson.definitions['OperationOutcome'] = {} = operationOutcome;

    var bundle = {
		description: 'A container for a collection of resources.',
		properties: {
			resourceType: {
				description: 'This is a Bundle resource',
				type: 'string'
			},
			identifier: {
				description:
					"A persistent identifier for the bundle that won't change as a bundle is copied from server to server.",
				$ref: '#/definitions/Identifier'
			},
			type: {
				description:
					'Indicates the purpose of this bundle - how it is intended to be used.',
				enum: [
					'document',
					'message',
					'transaction',
					'transaction-response',
					'batch',
					'batch-response',
					'history',
					'searchset',
					'collection'
				]
			},
			timestamp: {
				description:
					'The date/time that the bundle was assembled - i.e. when the resources were placed in the bundle.',
				$ref: '#/definitions/instant'
			},
			total: {
				description:
					"If a set of search matches, this is the total number of entries of type 'match' across all pages in the search.  It does not include search.mode = 'include' or 'outcome' entries and it does not provide a count of the number of entries in the Bundle.",
				$ref: '#/definitions/unsignedInt'
			},
			link: {
				description:
					'A series of links that provide context to this bundle.',
				items: {
					description:
						'A container for a collection of resources.',
					properties: {
						id: {
							description:
								'Unique id for the element within a resource (for internal references). This may be any string value that does not contain spaces.',
							$ref: '#/definitions/string'
						},
						relation: {
							description:
								'A name which details the functional use for this link - see [http://www.iana.org/assignments/link-relations/link-relations.xhtml#link-relations-1](http://www.iana.org/assignments/link-relations/link-relations.xhtml#link-relations-1).',
							$ref: '#/definitions/string'
						},
						url: {
							description:
								'The reference details for the link.',
							$ref: '#/definitions/uri'
						}
					},
					additionalProperties: false
				},
				type: 'array'
			},
			entry: {
				description:
					'An entry in a bundle resource - will either contain a resource or information about a resource (transactions and history only).',
				items: {
					description:
						'A container for a collection of resources.',
					properties: {
						id: {
							description:
								'Unique id for the element within a resource (for internal references). This may be any string value that does not contain spaces.',
							$ref: '#/definitions/string'
						},
						link: {
							description:
								'A series of links that provide context to this entry.',
							items: {
								description:
									'A container for a collection of resources.',
								properties: {
									id: {
										description:
											'Unique id for the element within a resource (for internal references). This may be any string value that does not contain spaces.',
										$ref: '#/definitions/string'
									},
									relation: {
										description:
											'A name which details the functional use for this link - see [http://www.iana.org/assignments/link-relations/link-relations.xhtml#link-relations-1](http://www.iana.org/assignments/link-relations/link-relations.xhtml#link-relations-1).',
										$ref: '#/definitions/string'
									},
									url: {
										description:
											'The reference details for the link.',
										$ref: '#/definitions/uri'
									}
								},
								additionalProperties: false
							},
							type: 'array'
						},
						fullUrl: {
							description:
								'The Absolute URL for the resource.  The fullUrl SHALL NOT disagree with the id in the resource - i.e. if the fullUrl is not a urn:uuid, the URL shall be version-independent URL consistent with the Resource.id. The fullUrl is a version independent reference to the resource. The fullUrl element SHALL have a value except that: \n* fullUrl can be empty on a POST (although it does not need to when specifying a temporary id for reference in the bundle)\n* Results from operations might involve resources that are not identified.',
							$ref: '#/definitions/uri'
						},
						resource: {
							description:
								'The Resource for the entry. The purpose/meaning of the resource is determined by the Bundle.type.',
							$ref: '#/definitions/Resource'
						},
						search: {
							description:
								'Information about the search process that lead to the creation of this entry.',
							properties: {
								id: {
									description:
										'Unique id for the element within a resource (for internal references). This may be any string value that does not contain spaces.',
									$ref: '#/definitions/string'
								},
								mode: {
									description:
										"Why this entry is in the result set - whether it's included as a match or because of an _include requirement, or to convey information or warning information about the search process.",
									enum: ['match', 'include', 'outcome']
								},
								score: {
									description:
										"When searching, the server's search ranking score for the entry.",
									$ref: '#/definitions/decimal'
								}
							},
							additionalProperties: false
						},
						request: {
							description:
								'Additional information about how this entry should be processed as part of a transaction or batch.  For history, it shows how the entry was processed to create the version contained in the entry.',
							properties: {
								id: {
									description:
										'Unique id for the element within a resource (for internal references). This may be any string value that does not contain spaces.',
									$ref: '#/definitions/string'
								},
								method: {
									description:
										'In a transaction or batch, this is the HTTP action to be executed for this entry. In a history bundle, this indicates the HTTP action that occurred.',
									enum: [
										'GET',
										'HEAD',
										'POST',
										'PUT',
										'DELETE',
										'PATCH'
									]
								},
								url: {
									description:
										'The URL for this entry, relative to the root (the address to which the request is posted).',
									$ref: '#/definitions/uri'
								},
								ifNoneMatch: {
									description:
										'If the ETag values match, return a 304 Not Modified status. See the API documentation for ["Conditional Read"](http.html#cread).',
									$ref: '#/definitions/string'
								},
								ifModifiedSince: {
									description:
										'Only perform the operation if the last updated date matches. See the API documentation for ["Conditional Read"](http.html#cread).',
									$ref: '#/definitions/instant'
								},
								ifMatch: {
									description:
										'Only perform the operation if the Etag value matches. For more information, see the API section ["Managing Resource Contention"](http.html#concurrency).',
									$ref: '#/definitions/string'
								},
								ifNoneExist: {
									description:
										'Instruct the server not to perform the create if a specified resource already exists. For further information, see the API documentation for ["Conditional Create"](http.html#ccreate). This is just the query portion of the URL - what follows the "?" (not including the "?").',
									$ref: '#/definitions/string'
								}
							},
							additionalProperties: false
						},
						response: {
							description:
								"Indicates the results of processing the corresponding 'request' entry in the batch or transaction being responded to or what the results of an operation where when returning history.",
							properties: {
								id: {
									description:
										'Unique id for the element within a resource (for internal references). This may be any string value that does not contain spaces.',
									$ref: '#/definitions/string'
								},
								status: {
									description:
										'The status code returned by processing this entry. The status SHALL start with a 3 digit HTTP code (e.g. 404) and may contain the standard HTTP description associated with the status code.',
									$ref: '#/definitions/string'
								},
								location: {
									description:
										'The location header created by processing this operation, populated if the operation returns a location.',
									$ref: '#/definitions/uri'
								},
								etag: {
									description:
										'The Etag for the resource, if the operation for the entry produced a versioned resource (see [Resource Metadata and Versioning](http.html#versioning) and [Managing Resource Contention](http.html#concurrency)).',
									$ref: '#/definitions/string'
								},
								lastModified: {
									description:
										'The date/time that the resource was modified on the server.',
									$ref: '#/definitions/instant'
								},
								outcome: {
									description:
										'An OperationOutcome containing hints and warnings produced as part of processing this entry in a batch or transaction.',
									$ref: '#/definitions/Resource'
								}
							},
							additionalProperties: false
						}
					},
					additionalProperties: false
				},
				type: 'array'
			},
			signature: {
				description:
					'Digital Signature - base64 encoded. XML-DSig or a JWT.',
				$ref: '#/definitions/Signature'
			}
		},
		additionalProperties: false,
		required: ['resourceType']
	};
    outputJson.definitions['Bundle'] = {} = bundle;
    
    var unsignedInt = {
		pattern: '^[0]|([1-9][0-9]*)$',
		type: 'number',
		description: 'An integer with a value that is not negative (e.g. \u003e\u003d 0)'
    };
    outputJson.definitions['unsignedInt'] = {} = unsignedInt;

    var Resource = {
		properties: {
			resourceType: {
				type: 'string'
			},
			id: {
				$ref: '#/definitions/id'
			},
			meta: {
				$ref: '#/definitions/Meta'
			},
			implicitRules: {
				$ref: '#/definitions/uri'
			},
			language: {
				$ref: '#/definitions/code'
			}
		}
    };
    outputJson.definitions['Resource'] = {} = Resource;

    var Signature = {
		description:
			'A signature along with supporting context. The signature may be a digital signature that is cryptographic in nature, or some other signature acceptable to the domain. This other signature may be as simple as a graphical image representing a hand-written signature, or a signature ceremony Different signature approaches have different utilities.',
		properties: {
			id: {
				description:
					'Unique id for the element within a resource (for internal references). This may be any string value that does not contain spaces.',
				$ref: '#/definitions/string'
			},
			type: {
				description:
					'An indication of the reason that the entity signed this document. This may be explicitly included as part of the signature information and can be used when determining accountability for various actions concerning the document.',
				items: {
					$ref: '#/definitions/Coding'
				},
				type: 'array'
			},
			when: {
				description: 'When the digital signature was signed.',
				$ref: '#/definitions/instant'
			},
			who: {
				description:
					'A reference to an application-usable description of the identity that signed  (e.g. the signature used their private key).',
				$ref: '#/definitions/Reference'
			},
			onBehalfOf: {
				description:
					'A reference to an application-usable description of the identity that is represented by the signature.',
				$ref: '#/definitions/Reference'
			},
			targetFormat: {
				description:
					'A mime type that indicates the technical format of the target resources signed by the signature.',
				$ref: '#/definitions/code'
			},
			sigFormat: {
				description:
					'A mime type that indicates the technical format of the signature. Important mime types are application/signature+xml for X ML DigSig, application/jose for JWS, and image/* for a graphical image of a signature, etc.',
				$ref: '#/definitions/code'
			},
			data: {
				description:
					'The base64 encoding of the Signature content. When signature is not recorded electronically this element would be empty.',
				$ref: '#/definitions/base64Binary'
			},
		},
		additionalProperties: false,
		required: ['type', 'who']
    };
    outputJson.definitions['Signature'] = {} = Signature;

    var base64Binary = {
		type: 'string',
		description: 'A stream of bytes'
    };
    outputJson.definitions['base64Binary'] = {} = base64Binary;
    
    var decimal = {
		pattern: '^-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?$',
		type: 'number',
		description: 'A rational number with implicit precision'
    };
    outputJson.definitions['decimal'] = {} = decimal;   
}

function traverseElement() {
    tagArray.forEach((e) => {
        // console.debug('Traversing through : ' + e);

        var element = JSONPath({ path: jPath + e, json: schemaJson })[0];
        properties = JSONPath({ path: '$.properties', json: element })[0];
        
        if (!properties) { return; }

        Object.keys(properties).forEach((key) => {
            buildDefinition(e, key);
        });
    });
}

function buildPaths() {

	//#region produces section
	var produces = [
		"application/json",
		"application/xml",
		"application/fhir+xml",
		"application/fhir+json"
	];
	outputJson.produces = produces;
	//#endregion

    //#region / path
    // TODO: specify search parameters
    var path = `/${keyword}`;
    outputJson.paths[path] = {};

    var post = {
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
		responses: {
			200: getSuccessResponse(keyword),
			default: getDefaultResponse('OperationOutcome')
		}
	};
    outputJson.paths[path]['post'] = post;

    var get = {
		tags: [keyword],
		parameters: buildSearchParameters(keyword),
		responses: {
			200: getSuccessResponse('Bundle'),
			default: getDefaultResponse('OperationOutcome')
		}
    };
    outputJson.paths[path]['get'] = get;
    //#endregion 

    //#region /Resource/{id} path
    path = `/${keyword}/{id}`;
    outputJson.paths[path] = {};

    var parameters = [
        {
            name: 'id',
            in: 'path',
            type: 'string',
            required: true
        }
    ]
    outputJson.paths[path]['parameters'] = {} = parameters;

    var get = {
		tags: [keyword],
		parameters: [],
		responses: {
			200: getSuccessResponse(keyword),
			default: getDefaultResponse('OperationOutcome')
		}
    };
    outputJson.paths[path]['get'] = get;

    var put = {
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
		responses: {
			200: getSuccessResponse(keyword),
			default: getDefaultResponse('OperationOutcome')
		}
    };
    outputJson.paths[path]['put'] = put;

    var del = {
		tags: [keyword],
		parameters: [],
		responses: {
			200: getSuccessResponse('OperationOutcome'),
			default: getDefaultResponse('OperationOutcome')
		}
    };
    outputJson.paths[path]['delete'] = del;
    //#endregion

    //#region /Resource/_history path
    // TODO: specify parameters
    path = `/${keyword}/_history`;
	outputJson.paths[path] = {};
	
	var historyParameters = [
		{
			name: '_since',
			in: 'query',
			type: 'string',
		},
		{
			name: '_count',
			in: 'query',
			type: 'string',
		}
	];

    var get = {
        tags: [keyword],
        parameters: historyParameters,
        responses: {
            200: getSuccessResponse('Bundle'),
            default: getDefaultResponse('OperationOutcome')
        }
    }
    outputJson.paths[path]['get'] = {} = get;
    //#endregion

    //#region /Resource/{id}/_history path
    // TODO: specify parameters
    path = `/${keyword}/{id}/_history`;
    outputJson.paths[path] = {};

    var get = {
		tags: [keyword],
        parameters: [
            {
                name: 'id',
                in: 'path',
                type: 'string',
                required: true
			}	
        ].concat(historyParameters),
		responses: {
			200: getSuccessResponse('Bundle'),
			default: getDefaultResponse('OperationOutcome')
		}
	};

    // FIXME: implement get method
    outputJson.paths[path]['get'] = {} = get;
    //#endregion

    //#region /Resource/{id}/_history/{vid} path
    // TODO: specify parameters
    path = `/${keyword}/{id}/_history/{vid}`;
    outputJson.paths[path] = {};

    var get = {
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
		responses: {
			200: getSuccessResponse(keyword),
			default: getDefaultResponse('OperationOutcome')
		}
	};
    outputJson.paths[path]['get'] = {} = get;
    //#endregion
}

function buildSearchParameters(element) {

	// TODO: build search query parameters for path
	var searchParamJson = JSON.parse(fs.readFileSync('./schemas/search-parameters.json'));
	var entries = JSONPath({ path: '$.entry.*', json: searchParamJson });

	var quaryParams = [];

	Object.keys(entries).forEach(k => {
		
		var entry = entries[k]['resource'];
		if (entry['base'].includes(element) || entry['name'].startsWith('_')) {
			quaryParams.push({
				name: entry['name'],
				in: 'query',
				type: 'string',
				description: entry['description']
			});
		}
	});

	return quaryParams;
}

function getSuccessResponse(element) {
    var success = {
        description: 'Success'
    }

    if (element) {
        success['schema'] = {
			$ref: `#/definitions/${element}`
		};
    }

    return success;
}

function getDefaultResponse(element) {
    var error = {
		description: 'Unexpected Error'
	};

	if (element) {
		error['schema'] = {
			$ref: `#/definitions/${element}`
		};
	}

	return error;
}

// write output json file
fs.writeFileSync(`${args.outputFolder}/${keyword.toLowerCase()}-output.json`, JSON.stringify(outputJson), (err) => {
    if (err) {
        console.error(err);
    }
});

console.log('Finished Processing');