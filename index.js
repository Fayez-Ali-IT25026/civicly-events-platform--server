import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import 'dotenv/config'
import cors from 'cors'



const app = express();
const PORT = 8000;



app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());




const client = new MongoClient(process.env.MONGODB_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB()
const db = connectedClient.db('civicly-events-platform');
const events = db.collection('addVents');
// ADDED: collection storing event joins (event + user data), used by the
// Join Event feature of the assignment.
const joins = db.collection('eventJoins');


app.get("/", (req, res) => {
  res.send("Server running fine");
});


// Create Event API
app.post("/events", async (req, res) => {
  try {
    const {
      title,
      description,
      eventType,
      image,
      location,
      eventDate,
    } = req.body;

    // Validate required fields
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

    // Validate event date
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
      eventDate <= today
    ) {
      return res.status(400).send({
        message: "Event date must be in the future!",
      });
    }

    // Validate image URL
    let imageUrl;

    try {
      imageUrl = new URL(image);
    } catch {
      return res.status(400).send({
        message: "Invalid image URL!",
      });
    }

    if (!["http:", "https:"].includes(imageUrl.protocol)) {
      return res.status(400).send({
        message: "Invalid image URL!",
      });
    }

    // Create event object
    const newEvent = {
      title: title.trim(),
      description: description.trim(),
      eventType,
      image: imageUrl.toString(),
      location: location.trim(),
      eventDate,

      // We'll add verified user email here
      createdBy: req.body.createdBy,

      createdAt: new Date(),
    };

    // Insert into MongoDB
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



app.get('/events', async (req, res) => {
  const { createdBy } = req.query;
  const query = createdBy ? { createdBy: createdBy.toLowerCase() } : {};
  const result = await events.find(query).toArray();
  res.send(result);
});

// ADDED: join-status check so the details page can show "Already Joined"
// after a reload. GET /events/:id/join?userId=... -> { joined: boolean }
app.get('/events/:id/join', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    // CHANGED: validate ObjectId — previously a malformed id threw inside
    // `new ObjectId(id)` and crashed the route with a 500.
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid event id!" });
    }
    if (!userId) {
      return res.status(400).send({ message: "userId is required!" });
    }

    const existing = await joins.findOne({ eventId: id, userId });
    res.send({ joined: Boolean(existing) });
  } catch (error) {
    console.error("Join status error:", error);
    res.status(500).send({ message: "Internal server error!" });
  }
});


// ADDED (assignment requirement): Join Event API — stores the join together
// with the event and user data in the `eventJoins` collection.
app.post('/events/:id/join', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, userEmail, userName } = req.body;

    // CHANGED: guard invalid ids (same 500 crash as above).
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid event id!" });
    }

    if (!userId || !userEmail) {
      return res.status(400).send({ message: "You must be logged in to join this event!" });
    }

    // The event must exist before someone can join it.
    const event = await events.findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res.status(404).send({ message: "Event not found!" });
    }

    // One join per user per event.
    const existing = await joins.findOne({ eventId: id, userId });
    if (existing) {
      return res.status(409).send({ message: "You have already joined this event!" });
    }

    // Store event + user data together, as required by the assignment.
    const joinDoc = {
      eventId: id,
      eventTitle: event.title,
      eventDate: event.eventDate,
      userId,
      userEmail,
      userName: userName || null,
      joinedAt: new Date(),
    };

    const result = await joins.insertOne(joinDoc);

    res.status(201).send({
      success: true,
      message: "You have joined the event!",
      join: { _id: result.insertedId, ...joinDoc },
    });
  } catch (error) {
    console.error("Join event error:", error);
    res.status(500).send({ message: "Internal server error!" });
  }
});






// UPDATE EVENT
app.patch("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      eventType,
      image,
      location,
      eventDate,
      createdBy,
    } = req.body;

    // Validate MongoDB ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid event ID",
      });
    }

    // Validate required fields
    if (
      !title ||
      !description ||
      !eventType ||
      !image ||
      !location ||
      !eventDate ||
      !createdBy
    ) {
      return res.status(400).send({
        success: false,
        message: "All fields are required",
      });
    }

    // Find existing event
    const existingEvent = await events.findOne({
      _id: new ObjectId(id),
    });

    if (!existingEvent) {
      return res.status(404).send({
        success: false,
        message: "Event not found",
      });
    }

    // Check event ownership
    if (
      existingEvent.createdBy?.toLowerCase() !==
      createdBy.toLowerCase()
    ) {
      return res.status(403).send({
        success: false,
        message: "You are not allowed to update this event",
      });
    }

    // Validate event date
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
    }).format(new Date());

    if (eventDate <= today) {
      return res.status(400).send({
        success: false,
        message: "Event date must be in the future",
      });
    }

    // Validate image URL
    try {
      const imageUrl = new URL(image);

      if (!["http:", "https:"].includes(imageUrl.protocol)) {
        throw new Error("Invalid image URL");
      }
    } catch {
      return res.status(400).send({
        success: false,
        message: "Please provide a valid image URL",
      });
    }

    // Update event
    const updatedEvent = {
      title: title.trim(),
      description: description.trim(),
      eventType,
      image,
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
      message: "Event updated successfully",
      event: result,
    });
  } catch (error) {
    console.error("Update event error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to update event",
    });
  }
});



app.delete("/events/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { createdBy } = req.query;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid event id!" });
    }

    const event = await events.findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res.status(404).send({ message: "Event not found!" });
    }

    if (event.createdBy?.toLowerCase() !== createdBy?.toLowerCase()) {
      return res.status(403).send({ message: "You can only delete your own events!" });
    }

    await events.deleteOne({ _id: new ObjectId(id) });
    await joins.deleteMany({ eventId: id });

    res.send({ success: true, message: "Event deleted successfully!" });
  } catch (error) {
    console.error("Delete event error:", error);
    res.status(500).send({ message: "Internal server error!" });
  }
});


app.get("/joined-events", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).send({ message: "userId is required!" });
    }

    const userJoins = await joins.find({ userId }).toArray();

    const eventIds = userJoins
      .map((join) => join.eventId)
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const result = await events
      .find({ _id: { $in: eventIds } })
      .sort({ eventDate: 1 })
      .toArray();

    res.send(result);
  } catch (error) {
    console.error("Joined events error:", error);
    res.status(500).send({ message: "Internal server error!" });
  }
});


app.get('/events/:id', async(req,res) => {

  const id = req.params.id;

  // CHANGED: validate ObjectId + return 404 instead of crashing with 500
  // on malformed/unknown ids (the details page relies on these status codes).
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid event id!" });
  }

  const query = {_id : new ObjectId (id)};

  const result = await events.findOne(query);

  if (!result) {
    return res.status(404).send({ message: "Event not found!" });
  }

  res.send(result);


})








app.listen(PORT, () => {
  console.log(`server is running on PORT ${PORT}`);
});

