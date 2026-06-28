const express = require('express');
const app = express();
const dotenv = require('dotenv');
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
dotenv.config();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
    // BookedProperty delete
    app.delete("/BookedProperty", async (req, res) => {
      const { propertyId, tenantId } = req.query; // কুয়েরি প্যারামিটার থেকে আইডি নেওয়া হচ্ছে

      const result = await BookingCOllection.deleteOne({
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

    // 🔥 API to update payment status to 'paid' after a successful payment
    app.post("/api/bookings/update-status", async (req, res) => {
      try {
        const { sessionId } = req.body;

        if (!sessionId) {
          return res.status(400).json({ success: false, message: "Session ID is required" });
        }

        // 1. Retrieve the session object from Stripe (including metadata)
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // 2. Check if the payment status is actually 'paid'
        if (session.payment_status === 'paid') {

          // Extract IDs from the Stripe session metadata
          const { tenantId, propertyId } = session.metadata;

          // 3. Update the booking data in MongoDB matching tenantId and propertyId
          const result = await BookingCOllection.updateOne(
            {
              propertyId: propertyId,
              tenantId: tenantId,
              paymentStatus: "unpaid" // Only update bookings that are currently pending
            },
            {
              $set: { paymentStatus: "paid" }
            }
          );

          if (result.matchedCount === 0) {
            return res.status(404).json({
              success: false,
              message: "No pending booking found matching these details, or it is already paid."
            });
          }

          return res.status(200).json({
            success: true,
            message: "Payment verified successfully. Booking status updated to paid!"
          });
        }

        return res.status(400).json({ success: false, message: "Payment is incomplete." });

      } catch (error) {
        console.error("Error updating payment status:", error);
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // owner dashboard query
    app.get("/dashboard/owner", async (req, res) => {
      const query = {}
      if (req.query.ownerEmail) {
        query.ownerEmail = req.query.ownerEmail
      }
      const cursor = propertyCollection.find(query)
      const result = await cursor.toArray()
      res.json(result)
    })
    // owner property delete 
    app.delete("/dashboard/owner/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await propertyCollection.deleteOne(query);
      res.send(result);
    });

    // update owner property 
    app.patch("/dashboard/owner/:id", async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body; // ফ্রন্টএন্ড থেকে পাঠানো সম্পূর্ণ অবজেক্ট
  const filter = { _id: new ObjectId(id) };
  
  const updateDoc = {
    $set: {
      title: updatedData.title,
      location: updatedData.location,
      propertyType: updatedData.propertyType,
      price: updatedData.price,
      rentType: updatedData.rentType,
      bedrooms: updatedData.bedrooms,
      bathrooms: updatedData.bathrooms,
      size: updatedData.size,
      amenities: updatedData.amenities,
      extraFeatures: updatedData.extraFeatures,
      images: updatedData.images,
      description: updatedData.description,
      ownerPhone: updatedData.ownerPhone,
    },
  };

  const result = await propertyCollection.updateOne(filter, updateDoc);
  res.send(result);
});

// get booking all data for BookingRequestPage
app.get("/all/booking",async(req,res)=>{
   const result =await BookingCOllection.find().toArray()
   res.send(result)
})

// booking status update form owner 
app.patch('/bookings/:id', async (req, res) => {
    try {
        const { id } = req.params; 
        const { bookingStatus } = req.body; 

        if (!['accepted', 'rejected'].includes(bookingStatus)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid status. Allowed values are 'accepted' or 'rejected'." 
            });
        }
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
            $set: { bookingStatus: bookingStatus }
        };
        const result = await BookingCOllection.updateOne(query, updateDoc); 

        if (result.modifiedCount === 1) {
            return res.status(200).json({ 
                success: true, 
                message: `Booking has been ${bookingStatus} successfully.` 
            });
        } else {
            return res.status(404).json({ 
                success: false, 
                message: "Booking not found or no changes made." 
            });
        }
    } catch (error) {
        console.error("Backend Error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Internal server error", 
            error: error.message 
        });
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