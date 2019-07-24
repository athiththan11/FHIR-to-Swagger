# FHIR to Swagger

A command line tool to convert FHIR R4 to Swagger definitions.

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
fhir-to-swagger <Resource_Name> <Output_Directory>
```

for example:

If you need the `Coverage` resource inside the directory where you are executing

```shell
fhir-to-swagger Coverage .
```

#### Method 02

Execute the following command from the root directory

```shell
node server.js Coverage
```

The above command will generate the swagger-definitions and saves it inside the `/outputs` folder of the tool
