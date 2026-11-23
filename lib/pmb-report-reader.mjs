// A wall or weekly report can outlive its original PMB session. Concurrent
// reads in the same report share one renewal, and a second denial is returned.
export async function createPmbReportReader(config, authenticate, postJson) {
  const initialToken = await authenticate(config);
  let renewal;
  return async function read(path, body) {
    const renewalAtStart = renewal;
    const token = renewalAtStart ? await renewalAtStart : initialToken;
    const response = await postJson(config.baseUrl, path, body, token);
    if (response.status !== 401 || renewalAtStart) return response;
    renewal ??= authenticate(config);
    return postJson(config.baseUrl, path, body, await renewal);
  };
}
