module.exports = (logger) => (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
  if (status === 500) logger.error({ event: 'request_failed', status });
  // Never reflect raw error messages, request bodies, URLs, or stack traces.
  res.status(status).render('layouts/storefront', {
    title: res.locals.t(status === 500 ? 'errorTitle' : 'invalidRequestTitle'),
    contentView: '../errors/500',
    message: res.locals.t(status === 500 ? 'tryAgainMessage' : 'checkRequestMessage'),
  });
};
