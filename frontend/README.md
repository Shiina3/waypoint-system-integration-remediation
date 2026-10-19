# Waypoint frontend

This is the Next.js App Router frontend for Waypoint. For full project architecture, local setup, environment variables, API documentation, security notes, and deployment instructions, see the repository-root [README](../README.md) and [project description](../PROJECT-DESCRIPTION.md).

## Vercel setup

- Set the Vercel project root directory to `frontend`.
- Use the Next.js framework preset and `npm run build`.
- Set `NEXT_PUBLIC_API_URL` to the deployed Laravel API origin.
- Configure the Laravel CORS, Sanctum, and secure session-cookie settings for the frontend's production domain.
- Redeploy after changing environment variables, then test the deployed frontend and backend together.

`vercel.json` identifies the Next.js framework. It does not contain credentials or automatically create a Vercel deployment.
