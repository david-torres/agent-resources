const startHttpServer = (app) => new Promise((resolve, reject) => {
  const server = app.listen(0);
  server.once('error', reject);
  server.once('listening', () => {
    const address = server.address();
    resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
  });
});

const stopHttpServer = (server) => new Promise((resolve, reject) => {
  if (!server || !server.listening) return resolve();
  server.close(error => error ? reject(error) : resolve());
});

module.exports = { startHttpServer, stopHttpServer };
