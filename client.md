# `Client`
This is a FHIR client that is returned to you from the `ready()` call of the SMART API. You can also create it yourself if needed:
```js
// BROWSER
const client = FHIR.client("https:r4.smarthealthit.org");

// SERVER
const client = smart(req, res).client("https:r4.smarthealthit.org");
```
It exposes the following API:

<!--
### `client.getPatientId()`
### `client.getEncounterId()`
### `client.getIdToken()`
### `client.getFhirUser()`
### `client.getUserId()`
### `client.getUserType()`
-->
### client.`request(requestUriOrOptions[, fhirOptions]): Promise<Object>`
This is the single most important method. Please see the [live examples](http://docs.smarthealthit.org/client-js/request.html).

**requestUriOrOptions** can be a `String` URL, or an `URL instance` or an object having an `url` property. The `url` can be relative path that will be appended to your base URL. Using a full http URL will also work, as long as it is on the same domain as your base URL. Any other option will be passed to the underlying `fetch()` call.

The **fhirOptions** object can contain the following properties:

- **pageLimit** `Number` - When you request a Bundle, the result will typically come back in pages and you will only get the first page. You can set this to number bigger than `1` to request multiple pages. For example `pageLimit: 3` will give you the first 3 pages as array. To fetch all the available pages you can set this to `0`. **Defaults to `1`**. Ignored if the response is not a `Bundle`.
- **onPage** `Function` - When you fetch multiple pages the result array might be huge. That could take a lot of time and memory. It is often better if you specify a page callback instead. The `onPage` callback will be called once for each page with the page Bundle as it's argument. If you use `resolveReferences` and `graph: false`, the references will be passed to `onPage` as second argument.
    - If `onPage` returns a promise it will be awaited for, meaning that no more pages will be fetched until the `onPage` promise is resolved.
    - If `onPage` returns a rejected promise or throws an error, the client will not continue fetching more pages.
    - If you use an `onPage` callback options the promise returned by `request()` will be resolved with `null`. This is to avoid building that huge array in memory. By using the `onPage` option you are stating that you will handle the result one page at a time, instead of expecting to receive big combined result.
- **graph** `Boolean` - Only applicable if you use `resolveReferences`. If `false`, the resolved references will not be "mounted" in the result tree, but will be returned as separate map object instead. **Defaults to `true`**.
- **resolveReferences** `String|String[]` - One or more references to resolve. Single item can be specified as a string or as an array of one string. Multiple items must be specified as array.
    - Each item is a dot-separated path to the desired reference within the result object, excluding the "reference" property. For example `context.serviceProvider` will look for `{Response}.context.serviceProvider.reference`.
    - This is recursive so the order does matter. For example `["context", "context.serviceProvider"]` will work properly and first resolve the `context` reference, then it's `serviceProvider` reference. However, if you flip the order "context.serviceProvider" will fail because "context" is not resolved yet. * This option does not work with contained references (they are already "resolved" anyway).
- **useRefreshToken** `Boolean` - **Defaults to `true`**. If the client is authorized, it will possess an access token and pass it with the requests it makes. When that token expires, you should get back a `401 Unauthorized` response. When that happens, if the client also has a refresh token and if `useRefreshToken` is `true` (default), the client will attempt to automatically re-authorize itself and then it will re-run the failed request and eventually resolve it's promise with the final result. This means that your requests should never fail with `401`, unless the refresh token is also expired. If you don't want this, you can set `useRefreshToken` to `false`. There is a `refresh` method on the client that can be called manually to renew the access token.

***Examples:***

**Fetch single resource**
```js
client.request("Patient/id"); // Resolves with a Patient or rejects with an Error
```

**Fetch the current patient**
```js
client.request(`Patient/${client.patient.id}`); // Resolves with a Patient or rejects with an Error
```

**Fetch a bundle**
```js
client.request("Patient"); // Resolves with a Bundle or rejects with an Error
```

**Get all pages**
```js
client.request("Patient", { pageLimit: 0 });  // Resolves with array of Bundles or rejects with an Error
```

**Handle pages as they arrive**
```js
// Resolves with null or rejects with an Error
client.request("Patient", {
    pageLimit: 5,
    onPage(bundle) {
        // do something with the downloaded page
    }
});
```

**Resolve References**
```js
// Resolves with augmented Encounter or rejects with an Error
client.request(
    "Encounter/518a522a-4b10-47db-9daf-53b726d32607",
    resolveReferences: [ "serviceProvider" ]
);
```

**Extracting multiple related resources from single Observation:**
```js
// Resolves with Object (augmented Observation) or rejects with an Error
client.request(
    "Observation/smart-691-bmi",
    resolveReferences: [
        "context",                 // The Encounter
        "context.serviceProvider", // The Organization (hospital)
        "performer.0",             // The Practitioner
        "subject"                  // The Patient
    ]
);
```

**Getting the references as separate object**

Resolved references are "mounted" on the result tree, replacing
the value of the original reference property. If you don't want that behavior,
you can set the `graph` option of the `request` method to false. In this case,
the promise will be resolved with an object having two properties:
- `data` the original response data
- `references` a map of resolved references
```js
// Resolves with Object ({ data, references }) or rejects with an Error
client.request(
    "Encounter/518a522a-4b10-47db-9daf-53b726d32607",
    resolveReferences: [ "serviceProvider" ],
    graph: false
);
```

### client.`refresh(): Promise<Object>`
Use the refresh token to obtain new access token. If the refresh token is
expired (or this fails for any other reason) it will be deleted from the
state, so that we don't enter into loops trying to re-authorize.

> Note that that `client.request()` will automatically refresh the access token
for you!

Resolves with the updated state or rejects with an error.

### client.`api: Object`
Only accessible if fhir.js is available. Read more about the fhir.js integration here.

### client.`patient.id: String|null`
The selected patient ID or `null` if patient is not available. If no patient is selected, it will generate useful debug messages about the possible reasons. See [debugging](#Debugging).

### client.`patient.read(): Promise<Object>`
Fetches the selected patient resource (if available). Resolves with the patient or rejects with an error.

### client.`patient.api: Object`
Only accessible if fhir.js is available. Read more about the fhir.js integration here.

### client.`encounter.id: String|null`
The selected encounter ID or `null` if encounter is not available. If no encounter is selected, it will generate useful debug messages about the possible reasons. See debugging.

### client.`encounter.read(): Promise<Object>`
Fetches the selected encounter resource (if available). Resolves with the encounter or rejects with an error.

### client.`user.id: String`
The selected user ID or `null` if user is not available. If no user is selected, it will generate useful debug messages about the possible reasons. See [debugging](#Debugging).

### client.`user.fhirUser: String`
The selected user identifier that looks like `Practitioner/id` or `null` if user is not available. If no user is selected, it will generate useful debug messages about the possible reasons. See [debugging](#Debugging).

### client.`user.resourceType: String`
The selected user resourceType (E.g. `Practitioner`, `Patient`, `RelatedPerson`...) or `null` if user is not available. If no user is selected, it will generate useful debug messages about the possible reasons. See [debugging](#Debugging).

### client.`user.read(): Promise<Object>`
Fetches the selected user resource (if available). Resolves with the user or rejects with an error. 

---

Finally, there are some **utility methods**, mostly inherited by older versions of the library:
### client.`byCode(observations, property): Object`
Groups the observations by code. Returns a map that will look like:
```js
const map = client.byCodes(observations, "code");
// map = {
//     "55284-4": [ observation1, observation2 ],
//     "6082-2": [ observation3 ]
// }
```

### client.`byCodes(observations, property): Function`
Similar to `byCode` but builds the map internally and returns a filter function
that will produce flat arrays. For example:
```js
const filter = client.byCodes(observations, "category");
filter("laboratory") // => [ observation1, observation2 ]
filter("vital-signs") // => [ observation3 ]
filter("laboratory", "vital-signs") // => [ observation1, observation2, observation3 ]
```

### client.units.`cm({ code, value }): Number`
Converts the `value` to `code`, where `code` can be `cm`, `m`, `in`, `[in_us]`, `[in_i]`, `ft`, `[ft_us]`

### client.units.`kg({ code, value }): Number`
Converts the `value` to `code`, where `code` can be `kg`, `g`, string containing `lb`, string containing `oz`

### client.units.`any({ code, value }): Number`
Just asserts that `value` is a number and then returns that value

### client.`getPath(object, path): any`
Given an object (or array), tries to walk down to the given dot-separated path
and returns the value. It will return `undefined` if the path cannot find any property. It will NOT throw if an intermediate property does not exist.
The path is dot-separated even for arrays! Examples:
```js
const data = { a: { b: "x" }, c: [ 2, { x: 5}, [1,2,3] ]};
client.getPath(data, "") // => data
client.getPath(data, "a") // => { b: "x" }
client.getPath(data, "a.b") // => "x"
client.getPath(data, "c.1.x") // => 5
client.getPath(data, "c.2.1") // => 2
client.getPath(data, "a.b.c.d.e") // => undefined
```