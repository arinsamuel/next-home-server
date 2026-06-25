const express = require('express');
const app = express();
const dotenv = require('dotenv');
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
dotenv.config();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('NextHome Server is Running!')
});

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

    const database = client.db("NEXT-HOME");
    const propertyCollection = database.collection("all-property");
    const BookingCOllection = database.collection("BookingData")
    const favouritePropertyCollection = database.collection("favouriteProperty")

    // add-property 
    app.post('/owner/add-property', async (req, res) => {
      const data = req.body;
      if (data.price) {
        data.price = Number(data.price);
      }
      const result = await propertyCollection.insertOne(data);
      res.send(result);
    });

    // GET All Properties with Backend Filtering, Search & Sorting
    app.get("/properties", async (req, res) => {
      try {
        // ফ্রন্টএন্ড থেকে আসা কুয়েরি প্যারামিটার রিসিভ করা হচ্ছে
        const { search, type, sort } = req.query;

        // ১. বেসিক কুয়েরি অবজেক্ট (শুধুমাত্র Approved প্রোপার্টি দেখাবে)
        let query = { status: "Approved" };

        // ২. সার্চ বাই লোকেশন (Partial match & Case-insensitive)
        if (search) {
          query.location = { $regex: search, $options: 'i' };
        }

        // ৩. ফিল্টার বাই প্রোপার্টি টাইপ
        if (type) {
          query.propertyType = type;
        }

        // ৪. সর্টিং অপশন সেটআপ (ডিফল্ট ক্রিয়েশন ডেট অনুযায়ী থাকবে)
        let sortOption = {};
        if (sort === "low-to-high") {
          sortOption.price = 1; // ছোট থেকে বড়
        } else if (sort === "high-to-low") {
          sortOption.price = -1; // বড় থেকে ছোট
        }

        // ডাটাবেজ থেকে কুয়েরি অনুযায়ী ডেটা ফেচ করা
        const result = await propertyCollection
          .find(query)
          .sort(sortOption)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching filtered properties:", error);
        res.status(500).send({ message: "Internal server error", error: error.message });
      }
    });

    //get property detail page 
    app.get("/properties/:id", async (req, res) => {
      try {
        const { id } = req.params
        const property = await propertyCollection.findOne({ _id: new ObjectId(id) })
        res.json(property)
      } catch (error) {
        console.log(error);

      }
    })

    // Booking collection 
    app.post("/booking", async (req, res) => {
      const data = req.body
      const Booking = {
        ...data,
        createdAt: new Date()
      }
      const exists = await BookingCOllection.findOne({
        propertyId: data.propertyId,
        tenantId: data.tenantId
      });

      if (exists) {
        return res.status(400).json({ message: "Already Booked" });
      }
      const result = await BookingCOllection.insertOne(Booking)
      res.send(result)
    })

    // get booking data
    app.get("/booking/data", async (req, res) => {
      const query = {}
      if (req.query.tenantId) {
        query.tenantId = req.query.tenantId
      }
      const cursor = BookingCOllection.find(query)
      const result = await cursor.toArray()
      res.json(result)
    })

    // ১. favorite property
    app.post("/favouriteproperty", async (req, res) => {
      const data = req.body;

      // ডুপ্লিকেট এড়াতে প্রথমে চেক করে নিই এই ইউজার অলরেডি এই প্রপার্টি সেভ করেছে কি না
      const exists = await favouritePropertyCollection.findOne({
        propertyId: data.propertyId,
        tenantId: data.tenantId
      });

      if (exists) {
        return res.status(400).json({ message: "Already in favorites" });
      }

      const result = await favouritePropertyCollection.insertOne(data);
      res.send(result);
    });

    // ২. ফেভারিট লিস্ট থেকে ডিলিট করার API
    app.delete("/favouriteproperty", async (req, res) => {
      const { propertyId, tenantId } = req.query; // কুয়েরি প্যারামিটার থেকে আইডি নেওয়া হচ্ছে

      const result = await favouritePropertyCollection.deleteOne({
        propertyId: propertyId,
        tenantId: tenantId
      });

      res.send(result);
    });

    app.get("/favouriteproperty", async (req, res) => {
      const query = {}
      if (req.query.tenantId) {
        query.tenantId = req.query.tenantId
      }
      const cursor = favouritePropertyCollection.find(query)
      const result = await cursor.toArray()
      res.json(result)
    })

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`NextHome server listening on port ${port}`)
});