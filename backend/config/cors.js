export const getCorsOptions = () => {
  const corsOrigin = process.env.CLIENT_URL || 'http://localhost:5173';
  return {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
  };
};
