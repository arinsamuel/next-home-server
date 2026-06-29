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
    const alluser = database.collection("user")
    const transactionCollection = database.collection("transactions");

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
        const { search, type, sort } = req.query;

        let query = { status: "Approved" };

        if (search) {
          query.location = { $regex: search, $options: 'i' };
        }

        if (type) {
          query.propertyType = type;
        }

        let sortOption = {};
        if (sort === "low-to-high") {
          sortOption.price = 1;
        } else if (sort === "high-to-low") {
          sortOption.price = -1;
        }

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


    app.delete("/favouriteproperty", async (req, res) => {
      const { propertyId, tenantId } = req.query;

      const result = await favouritePropertyCollection.deleteOne({
        propertyId: propertyId,
        tenantId: tenantId
      });

      res.send(result);
    });
    // BookedProperty delete
    app.delete("/BookedProperty", async (req, res) => {
      const { propertyId, tenantId } = req.query;
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
      const updatedData = req.body;
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
    app.get("/all/booking", async (req, res) => {
      const result = await BookingCOllection.find().toArray()
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

    // get all user 
    app.get("/allusers", async (req, res) => {
      const data = await alluser.find().toArray()
      res.send(data)
    })

    // get all property
    app.get("/all/property", async (req, res) => {
      const data = await propertyCollection.find().toArray()
      res.send(data)
    })


    // payment  transaction 
    app.post("/api/transactions/save", async (req, res) => {
      try {
        const { sessionId } = req.body;

        if (!sessionId) {
          return res.status(400).json({ success: false, message: "Session ID is required" });
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log("============== STRIPE METADATA ==============");
        console.log(session.metadata);
        console.log("=============================================");

        if (session.payment_status === 'paid') {
          const transactionId = session.payment_intent || session.id;

          const existingTx = await transactionCollection.findOne({ transactionId });

          if (!existingTx) {
            const transactionInfo = {
              transactionId: transactionId,
              tenantName: session.customer_details?.name || "Premium Tenant",
              propertyName: session.metadata?.propertyName || "Premium Property",
              ownerName: session.metadata?.ownerName || "M. R. Rahman",
              amount: session.amount_total / 100,
              date: new Date(),
              tenantId: session.metadata?.tenantId || "N/A",
              propertyId: session.metadata?.propertyId || "N/A"
            };

            await transactionCollection.insertOne(transactionInfo);
          }

          return res.status(200).json({ success: true, message: "Transaction recorded!" });
        }

        return res.status(400).json({ success: false, message: "Payment not paid" });
      } catch (error) {
        console.error("Transaction Error:", error);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    app.get('/api/transactions', async (req, res) => {
      try {
        const result = await transactionCollection.find().sort({ date: -1 }).toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching transactions:", error);
        res.status(500).send({ success: false, message: error.message });
      }
    });

    // update propery status 
    app.patch('/api/properties/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { status, feedback } = req.body;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: status,
            feedback: status === 'Rejected' ? feedback : ''
          }
        };

        const result = await propertyCollection.updateOne(filter, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Property not found" });
        }

        return res.status(200).json({ message: "Success", updatedCount: result.modifiedCount });
      } catch (error) {
        console.error("Database Error:", error);
        return res.status(500).json({ message: "Error", error: error.message });
      }
    });

    // change user role 
app.patch('/api/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    // যদি সরাসরি MongoDB native driver ব্যবহার করেন:
    const result = await alluser.updateOne(
      { _id: new ObjectId(id) },
      { $set: { role: role } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json({ success: true, message: "Role updated successfully!" });

  } catch (error) {
    // এই লগটি আপনার নোড সার্ভারের টার্মিনালে প্রিন্ট হবে
    console.error("SERVER CRASH ERROR:", error); 
    res.status(500).json({ success: false, error: error.message });
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