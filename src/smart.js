const Client  = require("./Client");
const {
    isBrowser,
    debug,
    fetchJSON,
    getPath,
    randomString,
    btoa
} = require("./lib");

const SMART_KEY = "SMART_KEY";

function fetchConformanceStatement(baseUrl = "/")
{
    const url = String(baseUrl).replace(/\/*$/, "/") + "metadata";
    return fetchJSON(url).catch(ex => {
        throw new Error(`Failed to fetch the conformance statement from "${url}". ${ex}`);
    });
}

function fetchWellKnownJson(baseUrl = "/")
{
    const url = String(baseUrl).replace(/\/*$/, "/") + ".well-known/smart-configuration";
    return fetchJSON(url).catch(ex => {
        throw new Error(`Failed to fetch the well-known json "${url}". ${ex.message}`);
    });
}

/**
 * Given a fhir server returns an object with it's Oauth security endpoints that
 * we are interested in
 * @param baseUrl Fhir server base URL
 */
function getSecurityExtensions(baseUrl = "/")
{
    return fetchWellKnownJson(baseUrl).then(meta => {
        if (!meta.authorization_endpoint || !meta.token_endpoint) {
            throw new Error("Invalid wellKnownJson");
        }
        return {
            registrationUri: meta.registration_endpoint  || "",
            authorizeUri   : meta.authorization_endpoint,
            tokenUri       : meta.token_endpoint
        };
    }).catch(() => fetchConformanceStatement(baseUrl).then(metadata => {
        const nsUri = "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris";
        const extensions = (getPath(metadata || {}, "rest.0.security.extension") || [])
            .filter(e => e.url === nsUri)
            .map(o => o.extension)[0];

        const out = {
            registrationUri : "",
            authorizeUri    : "",
            tokenUri        : ""
        };

        if (extensions) {
            extensions.forEach(ext => {
                if (ext.url === "register") {
                    out.registrationUri = ext.valueUri;
                }
                if (ext.url === "authorize") {
                    out.authorizeUri = ext.valueUri;
                }
                if (ext.url === "token") {
                    out.tokenUri = ext.valueUri;
                }
            });
        }

        return out;
    }));
}

/**
 * @param {Object} params
 * @param {String} params.iss This should come as url parameter but can also be
 *  passed as an option for testing
 * @param {String} params.launch This should come as url parameter but can also
 *  be passed as an option for testing
 * @param {String} params.fhirServiceUrl Can be passed as an option or as an URL param.
 *  If present (and if `iss` is not present), it will make the client bypass the
 *  authorization
 * @param {String} params.redirectUri (or redirect_uri) redirect_uri Defaults to the current directory (it's index file)
 * @param {String} params.clientId // or "client_id"
 * @param {String} params.scope
 * @param {String} params.patientId
 * @param {String} params.encounterId
 * @param {Object} params.fakeTokenResponse
 * @param {Boolean} _noRedirect If true, resolve with the redirect url without
 *  trying to redirect to it
 */
async function authorize(env, params = {}, _noRedirect)
{
    // Obtain input
    let {
        iss,
        launch,
        fhirServiceUrl,
        redirect_uri,
        redirectUri,
        scope = "",
        clientSecret,
        fakeTokenResponse,
        patientId,
        encounterId,
        client_id,
        clientId
    } = params;

    const url = env.getUrl();

    // For these three an url param takes precedence over inline option
    iss            = url.searchParams.get("iss")            || iss;
    fhirServiceUrl = url.searchParams.get("fhirServiceUrl") || fhirServiceUrl;
    launch         = url.searchParams.get("launch")         || launch;

    if (!clientId) {
        clientId = client_id;
    }

    if (!redirectUri) {
        redirectUri = redirect_uri;
    }

    if (!redirectUri) {
        redirectUri = env.relative(".");
    } else {
        redirectUri = env.relative(redirectUri);
    }

    const serverUrl = String(iss || fhirServiceUrl || "");

    // Validate input
    if (!serverUrl) {
        throw new Error(
            "No server url found. It must be specified as `iss` or as " +
            "`fhirServiceUrl` parameter"
        );
    }

    if (iss) {
        debug("[authorize] Making %s launch...", launch ? "EHR" : "standalone");
    }

    // append launch scope if needed
    if (launch && !scope.match(/launch/)) {
        scope += " launch";
    }

    // prevent inheritance of tokenResponse from parent window
    await env.getStorage().unset(SMART_KEY);

    // create initial state
    const stateKey = randomString(16);
    const state = {
        clientId,
        scope,
        redirectUri,
        serverUrl,
        clientSecret,
        tokenResponse: {},
        key: stateKey
    };

    // fakeTokenResponse to override stuff (useful in development)
    if (fakeTokenResponse) {
        Object.assign(state.tokenResponse, fakeTokenResponse);
    }

    // Fixed patientId (useful in development)
    if (patientId) {
        Object.assign(state.tokenResponse, { patient: patientId });
    }

    // Fixed encounterId (useful in development)
    if (encounterId) {
        Object.assign(state.tokenResponse, { encounter: encounterId });
    }

    let redirectUrl = redirectUri + "?state=" + encodeURIComponent(stateKey);

    // bypass oauth if fhirServiceUrl is used (but iss takes precedence)
    if (fhirServiceUrl && !iss) {
        debug("[authorize] Making fake launch...");
        // Storage.set(stateKey, state);
        await env.getStorage().set(stateKey, state);
        if (_noRedirect) {
            return redirectUrl;
        }
        return await env.redirect(redirectUrl);
    }

    // Get oauth endpoints and add them to the state
    const extensions = await getSecurityExtensions(serverUrl);
    Object.assign(state, extensions);
    await env.getStorage().set(stateKey, state);

    // If this happens to be an open server and there is no authorizeUri
    if (!state.authorizeUri) {
        if (_noRedirect) {
            return redirectUrl;
        }
        return await env.redirect(redirectUrl);
    }

    // build the redirect uri
    const redirectParams = [
        "response_type=code",
        "client_id="    + encodeURIComponent(clientId),
        "scope="        + encodeURIComponent(scope),
        "redirect_uri=" + encodeURIComponent(redirectUri),
        "aud="          + encodeURIComponent(serverUrl),
        "state="        + encodeURIComponent(stateKey)
    ];

    // also pass this in case of EHR launch
    if (launch) {
        redirectParams.push("launch=" + encodeURIComponent(launch));
    }

    redirectUrl = state.authorizeUri + "?" + redirectParams.join("&");

    if (_noRedirect) {
        return redirectUrl;
    }

    return await env.redirect(redirectUrl);
}

/**
 * The completeAuth function should only be called on the page that represents
 * the redirectUri. We typically land there after a redirect from the
 * authorization server..
 */
async function completeAuth(env)
{
    const url = env.getUrl();
    const Storage = env.getStorage();

    let key                    = url.searchParams.get("state");
    const code                 = url.searchParams.get("code");
    const authError            = url.searchParams.get("error");
    const authErrorDescription = url.searchParams.get("error_description");

    if (!key) {
        key = await Storage.get(SMART_KEY);
    }

    // Start by checking the url for `error` and `error_description` parameters.
    // This happens when the auth server rejects our authorization attempt. In
    // this case it has no other way to tell us what the error was, other than
    // appending these parameters to the redirect url.
    // From client's point of view, this is not very reliable (because we can't
    // know how we have landed on this page - was it a redirect or was it loaded
    // manually). However, if `completeAuth()` is being called, we can assume
    // that the url comes from the auth server (otherwise the app won't work
    // anyway).
    if (authError || authErrorDescription) {
        let msg = [authError, authErrorDescription].filter(Boolean).join(": ");
        throw new Error(msg);
    }

    debug("[completeAuth] key: %s, code: %O", key, code);

    // key might be coming from the page url so it might be empty or missing
    if (!key) {
        throw new Error("No 'state' parameter found.");
    }

    // Check if we have a previous state
    let state = await Storage.get(key);

    const fullSessionStorageSupport = isBrowser() ?
        getPath(window, "FHIR.oauth2.settings.fullSessionStorageSupport") :
        true;

    // Do we have to remove the `code` and `state` params from the URL?
    if (isBrowser()) {
        const { settings } = window.FHIR.oauth2;
        const hasState = url.searchParams.has("state");

        if (settings.replaceBrowserHistory && (code || hasState)) {

            // `code` is the flag that tell us to request an access token.
            // We have to remove it, otherwise the page will authorize on
            // every load!
            if (code) {
                debug("[completeAuth] Removing code parameter from the url...");
                url.searchParams.delete("code");
            }

            // If we have `fullSessionStorageSupport` it means we no longer
            // need the `state` key. It will be stored to a well know
            // location - sessionStorage[SMART_KEY]. However, no
            // fullSessionStorageSupport means that this "well know location"
            // might be shared between windows and tabs. In this case we
            // MUST keep the `state` url parameter.
            if (hasState && fullSessionStorageSupport) {
                debug("[completeAuth] Removing state parameter from the url...");
                url.searchParams.delete("state");
            }

            // If the browser does not support the replaceState method for the
            // History Web API, the "code" parameter cannot be removed. As a
            // consequence, the page will (re)authorize on every load. The
            // workaround is to reload the page to new location without those
            // parameters. If that is not acceptable replaceBrowserHistory
            // should be set to false.
            if (window.history.replaceState) {
                window.history.replaceState({}, "", url.href);
            }
            else {
                await env.redirect(url.href);
            }
        }
    }

    // If the state does not exist, it means the page has been loaded directly.
    if (!state) {
        throw new Error("No state found! Please (re)launch the app.");
    }

    // If we have state, then check to see if we got a `code`. If we don't,
    // then this is just a reload. Otherwise, we have to complete the code flow
    if (code) {
        debug("[completeAuth] Preparing to exchange the code for access token...");
        const requestOptions = await buildTokenRequest(code, state);
        debug("[completeAuth] Token request options: %O", requestOptions);
        // The EHR authorization server SHALL return a JSON structure that
        // includes an access token or a message indicating that the
        // authorization request has been denied.
        let tokenResponse = await fetchJSON(state.tokenUri, requestOptions);
        debug("[completeAuth] Token response: %O", tokenResponse);
        if (!tokenResponse.access_token) {
            throw new Error("Failed to obtain access token.");
        }
        // save the tokenResponse so that we don't have to re-authorize on
        // every page reload
        state = { ...state, tokenResponse };
        await Storage.set(key, state);
        if (fullSessionStorageSupport) {
            await Storage.set(SMART_KEY, key);
        }
        debug("[completeAuth] Authorization successful!");
    }
    else {
        debug("[completeAuth] %s", state.tokenResponse.access_token ?
            "Already authorized" :
            "No authorization needed"
        );
    }

    const client = new Client(env, state);
    debug("[completeAuth] Created client instance: %O", client);
    return client;
}

/**
 * Builds the token request options. Does not make the request, just
 * creates it's configuration and returns it in a Promise.
 */
function buildTokenRequest(code, state)
{
    const { redirectUri, clientSecret, tokenUri, clientId } = state;

    if (!redirectUri) {
        throw new Error("Missing state.redirectUri");
    }

    if (!tokenUri) {
        throw new Error("Missing state.tokenUri");
    }

    if (!clientId) {
        throw new Error("Missing state.clientId");
    }

    const requestOptions = {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `code=${code}&grant_type=authorization_code&redirect_uri=${
            encodeURIComponent(redirectUri)}`
    };

    // For public apps, authentication is not possible (and thus not required),
    // since a client with no secret cannot prove its identity when it issues a
    // call. (The end-to-end system can still be secure because the client comes
    // from a known, https protected endpoint specified and enforced by the
    // redirect uri.) For confidential apps, an Authorization header using HTTP
    // Basic authentication is required, where the username is the app’s
    // client_id and the password is the app’s client_secret (see example).
    if (clientSecret) {
        requestOptions.headers.Authorization = "Basic " + btoa(
            clientId + ":" + clientSecret
        );
        debug(
            "[buildTokenRequest] Using state.clientSecret to construct the " +
            "authorization header: %s",
            requestOptions.headers.Authorization
        );
    } else {
        debug(
            "[buildTokenRequest] No clientSecret found in state. Adding " +
            "the client_id to the POST body"
        );
        requestOptions.body += `&client_id=${encodeURIComponent(clientId)}`;
    }

    return requestOptions;
}

async function ready(env, onSuccess, onError)
{
    let task = completeAuth(env);
    if (onSuccess) {
        task = task.then(onSuccess);
    }
    if (onError) {
        task = task.catch(onError);
    }
    return task;
}

async function init(env, options)
{
    const url   = env.getUrl();
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    // if `code` and `state` params are present we need to complete the auth flow
    if (code && state) {
        return completeAuth(env);
    }

    // Check for existing client state. If state is found, it means a client
    // instance have already been created in this session and we should try to
    // "revive" it.
    const storage = env.getStorage();
    const key     = state || await storage.get(SMART_KEY);
    const cached  = await storage.get(key);
    if (cached) {
        return Promise.resolve(new Client(env, cached));
    }

    // Otherwise try to launch
    return authorize(env, options).then(() => {
        // `init` promises a Client but that cannot happen in this case. The
        // browser will be redirected (unload the page and be redirected back
        // to it later and the same init function will be called again). On
        // success, authorize will resolve with the redirect url but we don't
        // want to return that from this promise chain because it is not a
        // Client instance. At the same time, if authorize fails, we do want to
        // pass the error to those waiting for a client instance.
        return new Promise(() => { /* leave it pending!!! */ });
    });
}

module.exports = {
    fetchConformanceStatement,
    fetchWellKnownJson,
    getSecurityExtensions,
    buildTokenRequest,
    authorize,
    completeAuth,
    ready,
    init,
    KEY: SMART_KEY
};
