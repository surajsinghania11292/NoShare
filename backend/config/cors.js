export const getCorsOptions = () => {
  const customOrigin = process.env.CLIENT_URL;

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      // Allow localhost or 127.0.0.1 on any port for local development
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }

      // Allow any Vercel deployment (production domain or preview branches)
      if (/^https:\/\/([a-zA-Z0-9_-]+\.)*vercel\.app$/.test(origin)) {
        return callback(null, true);
      }

      // Allow explicitly configured CLIENT_URL (supports comma-separated list)
      if (customOrigin) {
        const allowedOrigins = customOrigin
          .split(',')
          .map((url) => url.trim().replace(/\/$/, ''))
          .filter(Boolean);

        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
      }

      return callback(new Error(`CORS policy blocked access from origin: ${origin}`));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  };
};

