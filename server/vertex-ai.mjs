import { GoogleAuth } from 'google-auth-library';

export const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

// Vertex AI is configured by the project ID alone; credentials are Application Default Credentials.
export function vertexConfig(env) {
  const project = (env.GOOGLE_CLOUD_PROJECT || '').trim();
  if (!project) return null;
  return {
    project,
    location: (env.GOOGLE_CLOUD_LOCATION || '').trim() || 'global',
    model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
  };
}

export function vertexGenerateContentUrl({ project, location, model }) {
  const host =
    location === 'global' ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return (
    `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}` +
    `/publishers/google/models/${encodeURIComponent(model)}:generateContent`
  );
}

export function createAccessTokenProvider(auth = new GoogleAuth({ scopes: [VERTEX_SCOPE] })) {
  return async () => {
    const token = await auth.getAccessToken();
    if (!token) throw new Error('No Application Default Credentials access token.');
    return token;
  };
}
