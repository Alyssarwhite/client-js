# SMART API

Imagine that there is an object called "smart" that exposes the SMART-specific
methods. In the browser that is automatically created and is available at
`window.FHIR.oauth2`. On the server the library exports a function that you call
with your http request and response and it will create that "smart" object for you:

```js
// BROWSER
const smart = FHIR.oauth2;
smart.authorize(options);

// SERVER
const smart = require("fhirclient");
smart(request, response).authorize(options);
```
Once you have obtained that "smart" object, the API that it exposes is exactly
the same for the browser and the server.

### authorize(options) `Promise<never>`
Starts the [SMART Launch Sequence](http://hl7.org/fhir/smart-app-launch/#smart-launch-sequence).

> **IMPORTANT:** `authorize()` will end up redirecting you to the authorization server. This means that you should **not** add anything to the returned promise chain. Any code written directly after the `authorize()` call might not be executed due to that redirect!

The options that you would typically pass for an EHR launch are just `clientId`
and `scope`. For standalone launch you should also provide the `iss` option.
Here is the full list of options:

#### Common Options

|Name        |Type      |Description
|------------|----------|-----------
|clientId    |`String`  | The `client_id` that you have obtained while registering your app in the EHR. This is not required if you only intend to communicate with open FHIR servers. **Note:** For backwards compatibility reasons we also accept `client_id` instead of `clientId`!
|scope       |`String`  | One or more space-separated scopes that you would like to request from the EHR. [Learn more](http://hl7.org/fhir/smart-app-launch/scopes-and-launch-context/index.html)
|clientSecret|`String`  | If you have registered a confidential client, you should pass your `clientSecret` here. **Note: ONLY use this on the server**, as the browsers are considered incapable of keeping a secret. 
|iss         |`String`  | This is the URL of the service you are connecting to. For [EHR Launch](http://hl7.org/fhir/smart-app-launch/#ehr-launch-sequence) you **MUST NOT** provide this option. It will be passed by the EHR as url parameter instead. Using `iss` as an option will "lock" your app to that service provider. In other words, passing an `iss` option is how you do [Standalone Launch](http://hl7.org/fhir/smart-app-launch/#standalone-launch-sequence).
|redirectUri |`String`  | Where to redirect to after successful authorization. Defaults to the root (the index) of the current directory. **Note:** For backwards compatibility reasons we also accept `redirect_uri` instead of `redirectUri`!

#### Advanced Options
These should **ONLY** be used in development.

|Name             |Type      | Description
|-----------------|----------|-----------
|fhirServiceUrl   |`String`  | The base URL of the FHIR server to use. This is just like the `iss` option, except that it is designed to bypass the authentication. If `fhirServiceUrl` is passed, the `authorize` function will not actually attempt to authorize. It will skip that and redirect you to your `redirect_uri`.
|patientId        |`String`  | The ID of the selected patient. If you are launching against an open FHIR server, there is no way to obtain the launch context that would include the selected patient ID. This way you can "inject" that ID and make the client behave as if this is the currently active patient.
|encounterId      |`String`  | The ID of the selected encounter. If you are launching against an open FHIR server, there is no way to obtain the launch context that would (in some EHRs) include the selected encounter ID. This way you can "inject" that ID and make the client behave as if this is the currently active encounter.
|launch           |`String`  | The launch identifier that is typically provided by the launching EHR as `launch` url parameter. In development it is sometimes useful to be able to pass this as an option. For example, this could allow you to simulate launches from you tests.
|fakeTokenResponse|`Object`  | Useful for testing. This object can contain any properties that are typically contained in an [access token response](http://hl7.org/fhir/smart-app-launch/#step-3-app-exchanges-authorization-code-for-access-token). These properties will be stored into the client state, making it "believe" that it has been authorized.

### ready([onSuccess [, onError]]) `Promise<Client>`
This should be called on your `redirect_uri`. Returns a Promise that will eventually be resolved with a Client instance that you can use to query the fhir server.

> The `onSuccess` and `onError` callback functions are optional (and **deprecated**). We only accept them to keep the library compatible with older apps. If these functions are provided, they will simply be attached to the returned promise chain.

### init(options) `Promise<Client>`
This function can be used when you want to handle everything in one page (no launch endpoint needed). You can think of it as if it does:
```js
authorize(options).then(ready)
```
**options** is the same object you pass to the `authorize` method.

Example:
```js
FHIR.oauth2.init({
    client_id: "my_web_app",
    scope    : "patient/*.read"
}).then(client => /* initialize my app */);
```
**Be careful with `init()`!** There are some details you need to be aware of:
1. It will only work if your `launch_uri` is the same as your `redirect_uri`.
   While this should be valid, we can't promise that every EHR will allow you
   to register client with such settings.
2. Internally, init() will be called twice. First it will redirect to the EHR,
   then the EHR will redirect back to the page where `init()` will be called
   again to complete the authorization. This is generally fine, because the
   returned promise will only be resolved once, after the second execution,
   but please also consider the following:
   - You should wrap all your app's code in a function that is only executed
     after init() resolves!
   - Since the page will be loaded twice, you must be careful if your code has
     global side effects that can persist between page reloads (for example
     writing to localStorage).
   