const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const routes = require('./routes');
const notFound = require('./middleware/notFound.middleware');
const errorHandler = require('./middleware/error.middleware');
const { createWhatsAppConfig } = require('./config/whatsapp');
const { createWhatsAppOrderService } = require('./services/whatsapp-order.service');
const { createMediaDelivery } = require('./services/media-delivery.service');
const { checkDatabaseReadiness } = require('./services/database.service');
const { createOrderRoutes } = require('./routes/order.routes');
const { translate, cityName } = require('./config/storefront-i18n');
const formatPrice = require('./utils/formatPrice');
const { readAuthConfig } = require('./config/auth');
const { createAuthRoutes } = require('./routes/auth.routes');
const { createCustomerSessionMiddleware } = require('./middleware/customer-session.middleware');
const { createCartRoutes } = require('./routes/cart.routes');
const { getPrismaClient } = require('./config/prisma');
const { createNotificationRoutes } = require('./routes/notification.routes');
const { createCartRepository } = require('./repositories/cart.repository');
const { readCheckoutPolicy } = require('./config/checkout');
const { createAdminManagementRoutes } = require('./routes/admin-management.routes');
const { adminText } = require('./config/admin-i18n');
const { dashboardText } = require('./config/admin-dashboard-i18n');
const { createLocationRoutes } = require('./routes/location.routes');
const { createWishlistRoutes } = require('./routes/wishlist.routes');
const { createWishlistRepository } = require('./repositories/wishlist.repository');
const { logoutCsrfToken } = require('./routes/auth.routes');
const { createBackgroundJobsRoutes } = require('./routes/background-jobs.routes');

function createApp({ environment = 'development', logger = console, whatsappSettings = process.env, mediaSettings = process.env, mediaManifest,
  databaseReadiness = checkDatabaseReadiness, orders = {}, management = {}, authSettings = process.env, authRepository, cartRepository, wishlistRepository, catalogProvider } = {}) {
  const media = createMediaDelivery({ source: mediaSettings, manifest: mediaManifest });
  const cartStore = cartRepository || createCartRepository();
  const checkoutPolicy = orders.policy || readCheckoutPolicy(process.env, { databaseShipping: true });
  const app = express();
  app.set('env', environment);
  if (environment === 'production') app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(helmet({ strictTransportSecurity: environment === 'production' ? undefined : false,
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: environment === 'production' ? [] : null,
      // The Web SDK loads its configuration using JSONP from the API origin.
      scriptSrc: ["'self'", ...(authSettings.ONESIGNAL_APP_ID ? ['https://cdn.onesignal.com', 'https://api.onesignal.com'] : [])],
      connectSrc: ["'self'", ...(authSettings.ONESIGNAL_APP_ID ? ['https://onesignal.com', 'https://api.onesignal.com', 'https://cdn.onesignal.com'] : [])],
      workerSrc: ["'self'", 'blob:'], imgSrc: ["'self'", 'data:', ...(media.cloudName ? [`https://res.cloudinary.com/${media.cloudName}/`] : [])] } } }));
  // Public files must not authenticate or perform per-customer database queries.
  app.use('/assets', express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', maxAge: environment === 'production' ? '1h' : 0 }));
  app.get('/manifest.webmanifest', (req, res) => res.sendFile(path.join(__dirname, 'public', 'manifest.webmanifest')));
  app.get('/offline.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'offline.html')));
  app.get('/service-worker.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'service-worker.js'), { headers: { 'Service-Worker-Allowed': '/', 'Cache-Control': 'no-cache' } }));
  app.get(['/onesignal/OneSignalSDKWorker.js', '/OneSignalSDKWorker.js'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'onesignal', 'OneSignalSDKWorker.js'), { headers: { 'Service-Worker-Allowed': '/onesignal/', 'Cache-Control': 'no-cache' } }));
  app.use(createBackgroundJobsRoutes({ secret: authSettings.CRON_SECRET || process.env.CRON_SECRET, logger }));
  app.locals.siteName = 'Alreda Store';
  app.locals.year = new Date().getFullYear();
  const authConfig = readAuthConfig({ ...authSettings, NODE_ENV: environment });
  app.locals.googleAuthEnabled = authConfig.enabled;
  app.locals.checkoutEnabled = checkoutPolicy.enabled;
  app.locals.onesignalAppId = authSettings.ONESIGNAL_APP_ID || '';
  app.locals.logger = logger;
  app.locals.whatsapp = createWhatsAppConfig(whatsappSettings);
  app.locals.mediaAsset = media.assetUrl;
  app.locals.formatPrice = formatPrice;
  app.locals.cityName = cityName;
  app.use(createCustomerSessionMiddleware({ secure: environment === 'production', ...(authRepository ? { repository: authRepository } : {}) }));
  app.use((req, res, next) => {
    const locale = /(?:^|;\s*)alreda_locale=ar(?:;|$)/.test(req.get('cookie') || '') ? 'ar' : 'en';
    req.locale = locale;
    res.vary('Cookie');
    res.locals.locale = locale;
    res.locals.direction = locale === 'ar' ? 'rtl' : 'ltr';
    res.locals.returnTo = req.originalUrl;
    res.locals.logoutCsrfToken = logoutCsrfToken(req.customerSessionToken, authConfig.sessionSecret);
    res.locals.t = key => translate(locale, key);
    res.locals.a = key => adminText(locale, key);
    res.locals.dashboardText = key => dashboardText(locale, key);
    res.locals.adminPath = req.path;
    res.locals.number = value => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US').format(value);
    res.locals.productCount = value => {
      const count = Number(value);
      if (locale === 'ar') return count === 0 ? 'لا توجد منتجات' : count === 1 ? 'منتج واحد' : count === 2 ? 'منتجان' : `${res.locals.number(count)} منتجًا`;
      return `${res.locals.number(count)} ${count === 1 ? 'product' : 'products'}`;
    };
    next();
  });
  app.use(createAuthRoutes({ config: authConfig, ...(authRepository ? { repository: authRepository } : {}), cartRepository: cartStore, logger }));
  app.use(async (req, res, next) => {
    res.locals.notificationPreferences = { transactional_enabled: true, marketing_enabled: false };
    if (req.customer && app.locals.onesignalAppId) {
      try { res.locals.notificationPreferences = await getPrismaClient().notification_preferences.findUnique({ where: { user_id: req.customer.id } }) || res.locals.notificationPreferences; }
      catch { /* Account page stays usable while optional notification preferences are unavailable. */ }
    }
    next();
  });
  // Feature router owns raw webhook parsing; the provider receives untouched signature input.
  app.use(createOrderRoutes({ logger, csrfSecret: authConfig.sessionSecret, ...orders, policy: checkoutPolicy, cartRepository: cartStore,
    authenticate: orders.authenticate || (req => req.customer ? { userId: req.customer.id } : null),
    whatsappOrderService: orders.whatsappOrderService || createWhatsAppOrderService(whatsappSettings) }));
  app.use('/admin/catalog/products', express.urlencoded({ extended:false, limit:'256kb' }));
  app.use(['/admin/access', '/admin/catalog', '/admin/promotions'], express.urlencoded({ extended: false, limit: '64kb' }));
  app.use('/api/admin', express.json({ limit: '64kb' }));
  app.use(createAdminManagementRoutes({ ...management, csrfSecret: authConfig.sessionSecret }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(express.json({ limit: '16kb' }));
  app.use(createCartRoutes({ secure: environment === 'production', repository: cartStore }));
  app.use(createWishlistRoutes({ ...(wishlistRepository ? { repository: wishlistRepository } : { repository: createWishlistRepository(getPrismaClient) }), ...(catalogProvider ? { catalogProvider } : {}) }));
  app.use(createLocationRoutes());
  app.use(createNotificationRoutes({ enabled: Boolean(authSettings.ONESIGNAL_APP_ID) }));
  app.post('/language', (req, res) => {
    const locale = req.body?.locale;
    if (!['en', 'ar'].includes(locale)) return res.status(400).send('Invalid language selection.');
    const secure = environment === 'production' ? '; Secure' : '';
    res.set('Set-Cookie', `alreda_locale=${locale}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`);
    let destination = '/';
    try {
      const candidate = req.body?.returnTo || req.get('referer') || '/';
      if (typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.startsWith('/\\')) {
        const source = new URL(candidate, 'http://localhost');
        if (source.origin === 'http://localhost') destination = `${source.pathname}${source.search}${source.hash}`;
      }
    } catch { /* Use the storefront home page for malformed return locations. */ }
    return res.redirect(303, destination);
  });
  app.get('/health/live', (req, res) => res.set('Cache-Control', 'no-store').json({ status: 'ok' }));
  app.get('/health/ready', async (req, res) => {
    let ready = false;
    try { ready = await databaseReadiness(); } catch { /* Health responses never expose provider errors. */ }
    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });
  app.use(routes);
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}

module.exports = { createApp };
