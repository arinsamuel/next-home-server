const express = require('express');
const app = express();
const dotenv = require('dotenv');
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require('mongodb');
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

        // যদি ডেটার প্রাইস স্ট্রিং আকারে সেভ হয়ে থাকে, তাহলে সর্টিং নিখুঁত করতে
        // ডাটাবেজে পাঠানোর সময় অবশ্যই price-কে Number(price) করে পাঠাবেন।

        res.send(result);
      } catch (error) {
        console.error("Error fetching filtered properties:", error);
        res.status(500).send({ message: "Internal server error", error: error.message });
      }
    });

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`NextHome server listening on port ${port}`)
});