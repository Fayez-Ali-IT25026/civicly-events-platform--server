


import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import "dotenv/config";
import cors from "cors";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 8000;

// ------------------------------------
// Middleware
// ------------------------------------

// app.use(
//   cors({
//     origin: process.env.CLIENT_URL || "http://localhost:3000",
//     credentials: true,
//   })
// );

const allowedOrigins = [
  "https://civicly-events-platform.vercel.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());



// ------------------------------------
// MongoDB Connection
// ------------------------------------

if (!process.env.MONGODB_URI || !process.env.CLIENT_URL) {
  throw new Error("MONGODB_URI and CLIENT_URL are required!");
}

const client = new MongoClient(process.env.MONGODB_URI);

await client.connect();

console.log("Successfully connected to MongoDB!");

const db = client.db("civicly-events-platform");

const events = db.collection("addVents");
const joins = db.collection("eventJoins");

// Prevent duplicate joins
await joins.createIndex(
  { eventId: 1, userId: 1 },
  { unique: true }
);

// ------------------------------------
// Better Auth JWT Verification
// ------------------------------------

const JWKS = createRemoteJWKSet(
  new URL("/api/auth/jwks", process.env.CLIENT_URL)
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).send({
      message: "Unauthorized!",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const { payload } = await jwtVerify(token, JWKS);

    if (!payload.sub) {
      return res.status(401).send({
        message: "Invalid token!",
      });
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
    };

    next();
  } catch (error) {
    console.error("JWT verification error:", error);

    return res.status(401).send({
      message: "Invalid or expired token!",
    });
  }
};

// ------------------------------------
// Helper Functions
// ------------------------------------

const getToday = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

const isValidFutureDate = (date) => {
  return (
    typeof date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date &&
    date > getToday()
  );
};

const isValidImage = (image) => {
  try {
    const url = new URL(image);

    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
};

// ------------------------------------
// Home Route
// ------------------------------------

app.get("/", (req, res) => {
  res.send("Civicly server running fine!");
});

// ------------------------------------
// CREATE EVENT
// ------------------------------------

app.post("/events", verifyToken, async (req, res) => {
  try {
    const {
      title,
      description,
      eventType,
      image,
      location,
      eventDate,
    } = req.body;

    if (
      !title?.trim() ||
      !description?.trim() ||
      !eventType ||
      !image?.trim() ||
      !location?.trim() ||
      !eventDate
    ) {
      return res.status(400).send({
        message: "All fields are required!",
      });
    }

    if (!req.user.email) {
      return res.status(401).send({
        message: "User email not found in token!",
      });
    }

    if (!isValidFutureDate(eventDate)) {
      return res.status(400).send({
        message: "Event date must be in the future!",
      });
    }

    if (!isValidImage(image)) {
      return res.status(400).send({
        message: "Invalid image URL!",
      });
    }

    const newEvent = {
      title: title.trim(),
      description: description.trim(),
      eventType,
      image: new URL(image).toString(),
      location: location.trim(),
      eventDate,

      // Verified user information
      createdBy: req.user.email.toLowerCase(),
      createdByName: req.user.name || null,

      createdAt: new Date(),
    };

    const result = await events.insertOne(newEvent);

    res.status(201).send({
      success: true,
      message: "Event created successfully!",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Create event error:", error);

    res.status(500).send({
      message: "Internal server error!",
    });
  }
});

// ------------------------------------
// GET ALL EVENTS
// ------------------------------------

app.get("/events", async (req, res) => {
  try {
    const { createdBy } = req.query;

    const query = createdBy
      ? { createdBy: createdBy.toLowerCase() }
      : {};

    const result = await events.find(query).toArray();

    res.send(result);
  } catch (error) {
    console.error("Get events error:", error);

    res.status(500).send({
      message: "Failed to load events!",
    });
  }
});

// ------------------------------------
// GET SINGLE EVENT
// ------------------------------------

app.get("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid event ID!",
      });
    }

    const result = await events.findOne({
      _id: new ObjectId(id),
    });

    if (!result) {
      return res.status(404).send({
        message: "Event not found!",
      });
    }

    res.send(result);
  } catch (error) {
    console.error("Get event error:", error);

    res.status(500).send({
      message: "Internal server error!",
    });
  }
});

// ------------------------------------
// CHECK JOIN STATUS
// ------------------------------------

app.get("/events/:id/join", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid event ID!",
      });
    }

    const existing = await joins.findOne({
      eventId: id,
      userId: req.user.id,
    });

    res.send({
      joined: Boolean(existing),
    });
  } catch (error) {
    console.error("Join status error:", error);

    res.status(500).send({
      message: "Internal server error!",
    });
  }
});

// ------------------------------------
// JOIN EVENT
// ------------------------------------

app.post("/events/:id/join", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid event ID!",
      });
    }

    const event = await events.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).send({
        message: "Event not found!",
      });
    }

    const userId = req.user.id;

    const existing = await joins.findOne({
      eventId: id,
      userId,
    });

    if (existing) {
      return res.status(409).send({
        message: "You have already joined this event!",
      });
    }

    const joinDoc = {
      eventId: id,
      eventTitle: event.title,
      eventDate: event.eventDate,

      // Get identity from verified JWT
      userId,
      userEmail: req.user.email || null,
      userName: req.user.name || null,

      joinedAt: new Date(),
    };

    const result = await joins.insertOne(joinDoc);

    res.status(201).send({
      success: true,
      message: "You have joined the event!",
      join: {
        _id: result.insertedId,
        ...joinDoc,
      },
    });
  } catch (error) {
    console.error("Join event error:", error);

    if (error.code === 11000) {
      return res.status(409).send({
        message: "You have already joined this event!",
      });
    }

    res.status(500).send({
      message: "Internal server error!",
    });
  }
});

// ------------------------------------
// UPDATE EVENT
// ------------------------------------

app.patch("/events/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const {
      title,
      description,
      eventType,
      image,
      location,
      eventDate,
    } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid event ID!",
      });
    }

    if (
      !title?.trim() ||
      !description?.trim() ||
      !eventType ||
      !image?.trim() ||
      !location?.trim() ||
      !eventDate
    ) {
      return res.status(400).send({
        message: "All fields are required!",
      });
    }

    const existingEvent = await events.findOne({
      _id: new ObjectId(id),
    });

    if (!existingEvent) {
      return res.status(404).send({
        message: "Event not found!",
      });
    }

    // Check ownership using verified user
    if (
      existingEvent.createdBy?.toLowerCase() !==
      req.user.email?.toLowerCase()
    ) {
      return res.status(403).send({
        message: "You cannot update this event!",
      });
    }

    if (!req.user.email) {
      return res.status(401).send({
        message: "User email not found in token!",
      });
    }

    if (!isValidFutureDate(eventDate)) {
      return res.status(400).send({
        message: "Event date must be in the future!",
      });
    }

    if (!isValidImage(image)) {
      return res.status(400).send({
        message: "Invalid image URL!",
      });
    }

    const updatedEvent = {
      title: title.trim(),
      description: description.trim(),
      eventType,
      image: new URL(image).toString(),
      location: location.trim(),
      eventDate,
      updatedAt: new Date(),
    };

    await events.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedEvent }
    );

    const result = await events.findOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      message: "Event updated successfully!",
      event: result,
    });
  } catch (error) {
    console.error("Update event error:", error);

    res.status(500).send({
      message: "Failed to update event!",
    });
  }
});

// ------------------------------------
// DELETE EVENT
// ------------------------------------

app.delete("/events/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        message: "Invalid event ID!",
      });
    }

    const event = await events.findOne({
      _id: new ObjectId(id),
    });

    if (!event) {
      return res.status(404).send({
        message: "Event not found!",
      });
    }

    // Check ownership
    if (
      event.createdBy?.toLowerCase() !==
      req.user.email?.toLowerCase()
    ) {
      return res.status(403).send({
        message: "You can only delete your own events!",
      });
    }

    await events.deleteOne({
      _id: new ObjectId(id),
    });

    // Remove related joins
    await joins.deleteMany({
      eventId: id,
    });

    res.send({
      success: true,
      message: "Event deleted successfully!",
    });
  } catch (error) {
    console.error("Delete event error:", error);

    res.status(500).send({
      message: "Internal server error!",
    });
  }
});

// ------------------------------------
// GET JOINED EVENTS
// ------------------------------------

app.get("/joined-events", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const userJoins = await joins.find({
      userId,
    }).toArray();

    const eventIds = userJoins
      .map((join) => join.eventId)
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const result = await events
      .find({
        _id: { $in: eventIds },
      })
      .sort({ eventDate: 1 })
      .toArray();

    res.send(result);
  } catch (error) {
    console.error("Joined events error:", error);

    res.status(500).send({
      message: "Failed to load joined events!",
    });
  }
});

// ------------------------------------
// UPCOMING EVENTS
// ------------------------------------

app.get("/upcoming-events", async (req, res) => {
  try {
    const today = getToday();

    const result = await events
      .find({
        eventDate: { $gte: today },
      })
      .sort({ eventDate: 1 })
      .limit(6)
      .toArray();

    res.send(result);
  } catch (error) {
    console.error("Upcoming events error:", error);

    res.status(500).send({
      message: "Failed to load upcoming events!",
    });
  }
});

// ------------------------------------
// START SERVER
// ------------------------------------

app.listen(PORT, () => {
  console.log(`Civicly server is running on port ${PORT}`);
});


export default app


// import express from "express";
// import { MongoClient, ObjectId } from "mongodb";
// import 'dotenv/config'
// import cors from 'cors'
// import {
//   createRemoteJWKSet,
//   jwtVerify,
// } from "jose";



// const app = express();
// const PORT = 8000;



// app.use(
//   cors({
//     origin: process.env.CLIENT_URL || "http://localhost:3000",
//     credentials: true,
//   })
// );
// app.use(express.json());




// const client = new MongoClient(process.env.MONGODB_URI);
// export async function connectToMongoDB() {
//   try {
//     await client.connect();
//     console.log("You successfully connected to MongoDB!");
//     return client;
//   } catch (err) {
//     console.dir(err);
//   }
// }

// const connectedClient = await connectToMongoDB()
// const db = connectedClient.db('civicly-events-platform');
// const events = db.collection('addVents');
// // ADDED: collection storing event joins (event + user data), used by the
// // Join Event feature of the assignment.
// const joins = db.collection('eventJoins');



// const verifyToken = async (req, res, next) => {
//   const authHeader = req.headers.authorization;
//    if (!authHeader) {
//     return res.status(401).send({ msg: "Unauthorized!" });
//   }
//   const token = authHeader.split(" ")[1];
//   if (!token) {
//     return res.status(401).send({ msg: "Unauthorized!" });
//   }
  
  
//   const JWKS = createRemoteJWKSet(
//     new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
//   );

//   try { 
//     const { payload } = await jwtVerify(token, JWKS);

// req.user = {
//   id: payload.sub,
//   email: payload.email,
//   name: payload.name,
// };

// next();
//   } catch (error) {
//     return res.status(500).send({ msg: "Server Error!" });
//   } };








// app.get("/", (req, res) => {
//   res.send("Server running fine");
// });


// // Create Event API
// app.post("/events",verifyToken ,async (req, res) => {
//   try {
//     const {
//       title,
//       description,
//       eventType,
//       image,
//       location,
//       eventDate,
//     } = req.body;

//     // Validate required fields
//     if (
//       !title?.trim() ||
//       !description?.trim() ||
//       !eventType ||
//       !image?.trim() ||
//       !location?.trim() ||
//       !eventDate
//     ) {
//       return res.status(400).send({
//         message: "All fields are required!",
//       });
//     }

//     // Validate event date
//     const today = new Intl.DateTimeFormat("en-CA", {
//       timeZone: "Asia/Dhaka",
//       year: "numeric",
//       month: "2-digit",
//       day: "2-digit",
//     }).format(new Date());

//     if (
//       !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
//       eventDate <= today
//     ) {
//       return res.status(400).send({
//         message: "Event date must be in the future!",
//       });
//     }

//     // Validate image URL
//     let imageUrl;

//     try {
//       imageUrl = new URL(image);
//     } catch {
//       return res.status(400).send({
//         message: "Invalid image URL!",
//       });
//     }

//     if (!["http:", "https:"].includes(imageUrl.protocol)) {
//       return res.status(400).send({
//         message: "Invalid image URL!",
//       });
//     }

//     // Create event object
//     const newEvent = {
//       title: title.trim(),
//       description: description.trim(),
//       eventType,
//       image: imageUrl.toString(),
//       location: location.trim(),
//       eventDate,

//       // We'll add verified user email here
//       createdBy: req.body.createdBy,

//       createdAt: new Date(),
//     };

//     // Insert into MongoDB
//     const result = await events.insertOne(newEvent);

//     res.status(201).send({
//       success: true,
//       message: "Event created successfully!",
//       insertedId: result.insertedId,
//     });
//   } catch (error) {
//     console.error("Create event error:", error);

//     res.status(500).send({
//       message: "Internal server error!",
//     });
//   }
// });







// app.get('/events', async (req, res) => {
//   const { createdBy } = req.query;
//   const query = createdBy ? { createdBy: createdBy.toLowerCase() } : {};
//   const result = await events.find(query).toArray();
//   res.send(result);
// });





// // ADDED: join-status check so the details page can show "Already Joined"
// // after a reload. GET /events/:id/join?userId=... -> { joined: boolean }
// app.get('/events/:id/join',verifyToken , async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { userId } = req.query;

//     // CHANGED: validate ObjectId — previously a malformed id threw inside
//     // `new ObjectId(id)` and crashed the route with a 500.
//     if (!ObjectId.isValid(id)) {
//       return res.status(400).send({ message: "Invalid event id!" });
//     }
//     if (!userId) {
//       return res.status(400).send({ message: "userId is required!" });
//     }

//     const existing = await joins.findOne({ eventId: id, userId });
//     res.send({ joined: Boolean(existing) });
//   } catch (error) {
//     console.error("Join status error:", error);
//     res.status(500).send({ message: "Internal server error!" });
//   }
// });


// // ADDED (assignment requirement): Join Event API — stores the join together
// // with the event and user data in the `eventJoins` collection.
// app.post('/events/:id/join',verifyToken , async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { userId, userEmail, userName } = req.body;

//     // CHANGED: guard invalid ids (same 500 crash as above).
//     if (!ObjectId.isValid(id)) {
//       return res.status(400).send({ message: "Invalid event id!" });
//     }

//     if (!userId || !userEmail) {
//       return res.status(400).send({ message: "You must be logged in to join this event!" });
//     }

//     // The event must exist before someone can join it.
//     const event = await events.findOne({ _id: new ObjectId(id) });
//     if (!event) {
//       return res.status(404).send({ message: "Event not found!" });
//     }

//     // One join per user per event.
//     const existing = await joins.findOne({ eventId: id, userId });
//     if (existing) {
//       return res.status(409).send({ message: "You have already joined this event!" });
//     }

//     // Store event + user data together, as required by the assignment.
//     const joinDoc = {
//       eventId: id,
//       eventTitle: event.title,
//       eventDate: event.eventDate,
//       userId,
//       userEmail,
//       userName: userName || null,
//       joinedAt: new Date(),
//     };

//     const result = await joins.insertOne(joinDoc);

//     res.status(201).send({
//       success: true,
//       message: "You have joined the event!",
//       join: { _id: result.insertedId, ...joinDoc },
//     });
//   } catch (error) {
//     console.error("Join event error:", error);
//     res.status(500).send({ message: "Internal server error!" });
//   }
// });






// // UPDATE EVENT
// app.patch("/events/:id", verifyToken, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const {
//       title,
//       description,
//       eventType,
//       image,
//       location,
//       eventDate,
//       createdBy,
//     } = req.body;

//     // Validate MongoDB ID
//     if (!ObjectId.isValid(id)) {
//       return res.status(400).send({
//         success: false,
//         message: "Invalid event ID",
//       });
//     }

//     // Validate required fields
//     if (
//       !title ||
//       !description ||
//       !eventType ||
//       !image ||
//       !location ||
//       !eventDate ||
//       !createdBy
//     ) {
//       return res.status(400).send({
//         success: false,
//         message: "All fields are required",
//       });
//     }

//     // Find existing event
//     const existingEvent = await events.findOne({
//       _id: new ObjectId(id),
//     });

//     if (!existingEvent) {
//       return res.status(404).send({
//         success: false,
//         message: "Event not found",
//       });
//     }

//     // Check event ownership
//     if (
//       existingEvent.createdBy?.toLowerCase() !==
//       createdBy.toLowerCase()
//     ) {
//       return res.status(403).send({
//         success: false,
//         message: "You are not allowed to update this event",
//       });
//     }

//     // Validate event date
//     const today = new Intl.DateTimeFormat("en-CA", {
//       timeZone: "Asia/Dhaka",
//     }).format(new Date());

//     if (eventDate <= today) {
//       return res.status(400).send({
//         success: false,
//         message: "Event date must be in the future",
//       });
//     }

//     // Validate image URL
//     try {
//       const imageUrl = new URL(image);

//       if (!["http:", "https:"].includes(imageUrl.protocol)) {
//         throw new Error("Invalid image URL");
//       }
//     } catch {
//       return res.status(400).send({
//         success: false,
//         message: "Please provide a valid image URL",
//       });
//     }

//     // Update event
//     const updatedEvent = {
//       title: title.trim(),
//       description: description.trim(),
//       eventType,
//       image,
//       location: location.trim(),
//       eventDate,
//       updatedAt: new Date(),
//     };

//     await events.updateOne(
//       { _id: new ObjectId(id) },
//       { $set: updatedEvent }
//     );

//     const result = await events.findOne({
//       _id: new ObjectId(id),
//     });

//     res.send({
//       success: true,
//       message: "Event updated successfully",
//       event: result,
//     });
//   } catch (error) {
//     console.error("Update event error:", error);

//     res.status(500).send({
//       success: false,
//       message: "Failed to update event",
//     });
//   }
// });



// app.delete("/events/:id",verifyToken , async (req, res) => {
//   try {
//     const { id } = req.params;
//     const { createdBy } = req.query;

//     if (!ObjectId.isValid(id)) {
//       return res.status(400).send({ message: "Invalid event id!" });
//     }

//     const event = await events.findOne({ _id: new ObjectId(id) });
//     if (!event) {
//       return res.status(404).send({ message: "Event not found!" });
//     }

//     if (event.createdBy?.toLowerCase() !== createdBy?.toLowerCase()) {
//       return res.status(403).send({ message: "You can only delete your own events!" });
//     }

//     await events.deleteOne({ _id: new ObjectId(id) });
//     await joins.deleteMany({ eventId: id });

//     res.send({ success: true, message: "Event deleted successfully!" });
//   } catch (error) {
//     console.error("Delete event error:", error);
//     res.status(500).send({ message: "Internal server error!" });
//   }
// });


// app.get("/joined-events", verifyToken, async (req, res) => {
//   try {
//     const { userId } = req.query;

//     if (!userId) {
//       return res.status(400).send({ message: "userId is required!" });
//     }

//     const userJoins = await joins.find({ userId }).toArray();

//     const eventIds = userJoins
//       .map((join) => join.eventId)
//       .filter((id) => ObjectId.isValid(id))
//       .map((id) => new ObjectId(id));

//     const result = await events
//       .find({ _id: { $in: eventIds } })
//       .sort({ eventDate: 1 })
//       .toArray();

//     res.send(result);
//   } catch (error) {
//     console.error("Joined events error:", error);
//     res.status(500).send({ message: "Internal server error!" });
//   }
// });


// app.get('/events/:id', async(req,res) => {

//   const id = req.params.id;

//   // CHANGED: validate ObjectId + return 404 instead of crashing with 500
//   // on malformed/unknown ids (the details page relies on these status codes).
//   if (!ObjectId.isValid(id)) {
//     return res.status(400).send({ message: "Invalid event id!" });
//   }

//   const query = {_id : new ObjectId (id)};

//   const result = await events.findOne(query);

//   if (!result) {
//     return res.status(404).send({ message: "Event not found!" });
//   }

//   res.send(result);


// })




// app.get('/upcoming-events', async (req, res) => {
//   const today = new Intl.DateTimeFormat("en-CA", {
//     timeZone: "Asia/Dhaka",
//   }).format(new Date());

//   const result = await events
//     .find({ eventDate: { $gte: today } })
//     .sort({ eventDate: 1 })
//     .limit(6)
//     .toArray();

//   res.send(result);
// });



// app.listen(PORT, () => {
//   console.log(`server is running on PORT ${PORT}`);
// });