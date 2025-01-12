# Migration Instructions

This document describes the most important changes you might need to implement,
in order to update your SMART apps to support new versions of the `fhirclient`
library.

## Migrating to v2+

There are lots of changes in v2, compared to the older versions, so you should
probably start by reading [this](v2.md).

> This only covers browser-related changes, since versions below 2 were not server-compatible.

1. First make sure that you are loading the correct version of the library
    through the script tags.
2. `FHIR.oauth2.authorize()`
    In your launch page you should have a call to `FHIR.oauth2.authorize()`.
    This should work without any changes for EHR launch. For Standalone Launch,
    you probably  have something like:
    ```js
    FHIR.oauth2.authorize({
        client: {
            client_id: "...",
            scope: "..."
          },
          server: "https://my-launch-url"
    })
    ```
    For v2 you need to change that to:
    ```js
    FHIR.oauth2.authorize({
        client_id: "...",
        scope: "...",
        iss: "https://my-launch-url"
    })
    ```
3. `FHIR.oauth2.ready()`
    This is where apps are initialized. You probably call this with
    one or two callback arguments like:
    ```js
    FHIR.oauth2.ready(onSuccess, onError);
    ```
    In v2 this is acceptable, but ready returns a `Promise` and we
    advise you to change it to:
    ```js
    FHIR.oauth2.ready().then(onSuccess).catch(onError);
    ```
    At this point, review the code of those two callback and consider
    the following:
    - `onError` is now a promise rejection handler. As such, it will
    always be called with single argument that is an Error instance
    (no more multiple argument or string messages or custom objects).
    - `onSuccess` is now part of the promise chain. If you throw an
    an error or return a rejected promise, the error should propagate
    to your `onError function`
    - You can return a `Promise` from `onSuccess` and it will be awaited for.

4. Once you have the SMART part (`authorize` and `ready`) working, it
    is time to proceed to the FHIR queries. Allmost every http request
    made by this library before v2 was sent through `fhir.js`. Since v2,
    we recommend swithing to the built-in `request` function which comes
    with some bennefits.

    4.1. `patient.read()` Most of the apps are using information about the
    selected patient, so you probably have a call like `client.patient.read()`
    somewhere in your code. That should work in v2, but it returns a `Promise`
    instead of `jQuery.Deferred`. This means that things like:
    ```js
    patient.read().done(...).fail(...).always(...)
    ```
    must be changed to:
    ```js
    patient.read().then(...).catch(...).finally(...)
    ```

    4.2. Other requests should be convertable to `client.request()`. We can't
    cover every possible scenario, but we can provide an example for one use case
    that seems to be very common - fetching patient observations.
    ```js
    FHIR.oauth2.ready()
    
        .then(client => {

            const query = new URLSearchParams();
            query.set("patient", client.patient.id);
            query.set("_count", 100); // fetch fewer pages if the server supports it
            query.set("code", [
                'http://loinc.org|29463-7', // weight
                'http://loinc.org|3141-9' , // weight
                'http://loinc.org|8302-2' , // Body height
                'http://loinc.org|8306-3' , // Body height - lying
                'http://loinc.org|8287-5' , // headC
                'http://loinc.org|39156-5', // BMI
                'http://loinc.org|18185-9', // gestAge
                'http://loinc.org|37362-1', // bone age
                'http://loinc.org|11884-4'  // gestAge
            ].join(","));

            return client.request("Observation?" + query, {
                pageLimit: 0,   // get all pages
                flat     : true // return flat array of Observation resources
            }).then(observations => {
                const getObservations = client.byCodes(observations, "code");
                console.log("height", getObservations("8302-2", "8306-3"));
                console.log("weight", getObservations("29463-7", "3141-9"));
                // ...
            });
        })
        
        .catch(console.error);
    ```


