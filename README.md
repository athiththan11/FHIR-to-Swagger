# FHIR to Swagger

A command line tool to convert FHIR R4 (4.0 Schema) to Swagger definitions.

[:construction: Work-In-Progress]

This tool uses the official specs and schemas provided by HL7 to generate swagger definitions. You can find the specs and schemas inside the `/schemas` directory.

Also you can download the specs from [here](https://www.hl7.org/fhir/downloads.html)

## Build, Install & Run

### Build & Install

Clone or download the project and execute the following command (from the root directory) to install relevant dependencies

> Use NodeJS `11.14.0v` for error free instalation and execution

```shell
npm install
```

### Run

You can run the tool by following either methods

#### Method 01

Execute the following command (from the root Directory) to link the tool with shell

```shell
npm link
```

and use the following command pattern to execute the tool

```shell
fhir-to-swagger [Resource_Name] <--combine> --output <Output_Directory>
```

for example:

1. Execute the following command to generate the swagger definition for `Coverage` resource. This will generate the swagger definition inside the current working directory

    ```shell
    fhir-to-swagger Coverage --output .
    ```

2. Execute the following command to generate the swagger definition for `Coverage` resource with passed `basePath`.

    ```shell
    fhir-to-swagger Coverage --base fhir-api --output .
    ```

3. Execute the following command to generate the swagger definition for `Coverage`, `Claim` & `ClaimResponse` resources. This will generate the swagger definitions inside the current working directory

    ```shell
    fhir-to-swagger Coverage Claim ClaimResponse --output .
    ```

4. Execute the following command to generate a combined swagger definition for `Coverage`, `Claim` & `ClaimResponse` resources. This will generate a combined swagger definitions inside the current working directory with the name `combined-swagger--output.json`

    ```shell
    fhir-to-swagger Coverage Claim ClaimResponse --combine --output .
    ```

5. Execute the folloing command to generate a combined swagger definition for `Coverage`, `Claim` & `ClaimResponse` resources with custom `version`, `basePath`, `host`.

    ```shell
    fhir-to-swagger Coverage Claim ClaimResponse --combine --title Combined--FHIR-API --host hapi.fhir.org --base fhir --swagger-version 2.0.0 --output .
    ```

#### Method 02

Execute the following command from the root directory

```shell
node server.js Coverage
```

The above command will generate the swagger-definitions and saves it inside the `/outputs` folder of the tool

## Tool

### Folder Structure

```txt

    -
    |- bin
    |    |- fhir-to-swagger
    |- schemas
    |    |- fhir.schema.json
    |    |- search-parameters.json
    |- utils
    |    |- utils.js
    |- server.js

```

### Usage

The tool uses an internally stored FHIR Schema to generate the swagger definitions for requested resources to comply with the original specifications.

> NOTE: This tool is not to generate swagger definitions from test servers or from any of the FHIR R4 servers. This tool generates a working swagger definition using the FHIR specs which are stored internally with the tool. The schemas and JSON specs used by the tool are downloaded from the [HL7 FHIR site](https://www.hl7.org/fhir/downloads.html)

The tool traverse through the `fhir.schema.json` file to identify the request resource and extracts it and other related attributes and models from the spec to generate the definitions. The `search-parameters.json` file is used to identify the common search parameters and Resource specific search query parameters. The tool extracts Resource related search query parameters using the `search-parameters.json` schema.

> **NOTE: Any changes to the above mentioned schema files can result in fault swagger definitions.**

Moreover, the tool generates all applicable resource paths for the request Resource.

For example: If Coverage resource has been requested using the below command

```shell
fhir-to-swagger Coverage --output .
```

then, the generated swagger definition (`coverage-output.json`) will include the following paths ...

* `/Coverage` : GET, POST
* `/Coverage/{id}` : GET, PUT, DELETE
* `/Coverage/_history` : GET
* `/Coverage/{id}/_history` : GET
* `/Coverage/{id}/_history/{vid}` : GET

### Limitations

The tool uses the `search-parameters.json` schema to identify and extract search query parameters related to a Resource as well as common parameters.

* Resource Chaining
* Modifiers

#### Resource Chaining

FHIR R4 supports advanced search operation called "Resource Chaining", but swagger doesn't have any support to define them.

As a workaround, the tool will traverse through the `search-parameters.json` schema and extracts the query parameters which are having their type as 'reference', and based on the given reference Resource, it agains traverse and extracts all related search parameters for them and appends them inside the parameters section.

> NOTE: The iteration and extraction is done only for one iteration of defined reference type Resource.

#### Searh Modifiers

The tool and the swagger doesn't support search modifiers of FHIR R4 resources and operations.
