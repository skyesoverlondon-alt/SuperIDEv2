export function getActor(req, context) {
  const netlifyUser = context?.clientContext?.user;
  if (netlifyUser?.sub || netlifyUser?.email) {
    return {
      id: netlifyUser.sub || netlifyUser.email,
      email: netlifyUser.email || '',
      mode: 'netlify-identity'
    };
  }
  const clientId = req.headers.get('x-skye-client-id') || 'public-local';
  return {
    id: clientId,
    email: '',
    mode: 'client-id'
  };
}
