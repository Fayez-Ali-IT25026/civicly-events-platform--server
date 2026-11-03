# Civicly Server

REST API for **Civicly**, a community platform where people create, join and track local social service events.

**Live API:** https://civicly-events-platform-server.vercel.app/
**Client Repository:** https://github.com/Fayez-Ali-IT25026/civicly-events-platform
**Live Site:** https://civicly-events-platform.vercel.app/

## Features

- **JWT-protected routes**: every private endpoint verifies a Better Auth JWT against the client's public keys (JWKS) using `jose`.
- **Owner-only actions**: only the creator of an event can update or delete it. The server checks the creator's email from the verified token, not from the request body.
- **Future dates only**: events with a past date are rejected on the server, and past events never appear in the upcoming lists.
- **Duplicate join protection**: a user cannot join the same event twice.
- **Server-side validation**: required fields and data are checked before anything is saved to MongoDB.
- **CORS locked to the client**: only the Civicly client origin can call the API.

## API Endpoints

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/` | Public | Server status check |
| GET | `/events` | Public | All upcoming events |
| GET | `/upcoming-events` | Public | Six nearest upcoming events for the home page |
| GET | `/events/:id` | Public | Single event details |
| POST | `/events` | Private | Create an event |
| PATCH | `/events/:id` | Private (owner) | Update an event |
| DELETE | `/events/:id` | Private (owner) | Delete an event |
| GET | `/events/:id/join` | Private | Check whether the logged-in user has joined |
| POST | `/events/:id/join` | Private | Join an event |
| GET | `/joined-events` | Private | Events joined by the logged-in user, sorted by date |

Private endpoints need an `Authorization: Bearer <token>` header.

## Tech Stack

Node.js, Express.js, MongoDB (native driver), jose, CORS, dotenv

## Getting Started

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/Fayez-Ali-IT25026/civicly-events-platform.git
   cd civicly-events-platform
   npm install
   ```

2. Create a `.env` file with your own MongoDB connection string and your client URL.

3. Start the server:

   ```bash
   node index.js
   ```

The server runs on port 8000 by default. The Civicly client must be running too, because the server reads its public keys from the client to verify tokens.