const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const { MongoClient } = require("mongodb");
require("dotenv").config();
const jwt = require("jsonwebtoken");

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection URL
// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.zunrmyl.mongodb.net/?retryWrites=true&w=majority`;
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
// const client = new MongoClient(uri, {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
// });

async function run() {
  try {
    // Connect to MongoDB
    client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("natural");
    const usercollection = db.collection("users");
    const productCollection = db.collection("products");

    // User Registration
    app.post("/api/register", async (req, res) => {
      const { name, email, password } = req.body;

      // Check if email already exists
      const existingUser = await usercollection.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "User already exists",
        });
      }

      // Hash the password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Insert user into the database
      await usercollection.insertOne({
        name,
        email,
        password: hashedPassword,
        role: "customer",
      });

      res.status(201).json({
        success: true,
        message: "User registered successfully",
      });
    });

    // User Login
    app.post("/api/login", async (req, res) => {
      const { email, password } = req.body;

      try {
        // Find user by email
        const user = await usercollection.findOne({ email });
        if (!user) {
          return res.status(401).json({ message: "Invalid email or password" });
        }

        // Compare hashed password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
          return res.status(401).json({ message: "Invalid email or password" });
        }

        // Generate JWT token
        const token = jwt.sign(
          { email: user.email, name: user.name }, // Include user details in token payload
          process.env.JWT_SECRET,
          { expiresIn: process.env.EXPIRES_IN }
        );

        // Respond with user details and token
        res.json({
          success: true,
          message: "Login successful",
          user: {
            name: user.name,
            email: user.email,
            role: user.role,
          },
          token,
        });
      } catch (error) {
        console.error("Error during login:", error);
        res.status(500).json({ message: "Something went wrong" });
      }
    });

    // product post

    // API to handle product posting
    app.post("/api/products/post", async (req, res) => {
      try {
        const { name, price, image, details } = req.body;

        // Validate request body
        if (!name || !price || !image || !details) {
          return res.status(400).json({
            message: "All fields (name, price, image, details) are required.",
          });
        }

        // Create a new product object
        const newProduct = {
          name,
          price: parseFloat(price), // Ensure price is a number
          image,
          details,
          createdAt: new Date(),
        };

        // Insert the product into the collection
        const result = await productCollection.insertOne(newProduct);

        res.status(201).json({
          message: "Product added successfully!",
          product: result.ops[0],
        });
      } catch (error) {
        console.error("Error while posting product:", error);
        res.status(500).json({ message: "Internal server error." });
      }
    });

    // get all products

    app.get("/api/products", async (req, res) => {
      try {
        const products = await productCollection.find().toArray(); // Convert cursor to array
        res.status(200).json(products); // Send the products as a JSON response
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ message: "Error fetching products" });
      }
    });

    // DELETE API to delete a product by ID
    app.delete("/api/products/:id", async (req, res) => {
      const productId = req.params.id; // Extract the product ID from the request params

      try {
        // Ensure the provided ID is a valid MongoDB ObjectId
        if (!ObjectId.isValid(productId)) {
          return res.status(400).json({ message: "Invalid product ID" });
        }

        // Delete the product from the collection
        const result = await productCollection.deleteOne({
          _id: new ObjectId(productId),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Product not found" });
        }

        res.status(200).json({ message: "Product deleted successfully" });
      } catch (error) {
        console.error("Error deleting product:", error);
        res.status(500).json({ message: "Error deleting product" });
      }
    });

    // user and unuser order palce

    const { ObjectId } = require("mongodb");

    app.post("/api/orders/user", async (req, res) => {
      const { email, product, customerDetails, quantity } = req.body;

      try {
        // Check if the email exists in the user collection
        const user = await usercollection.findOne({ email });

        if (user) {
          // User exists, add order to their record with a unique _id
          const newOrder = {
            _id: new ObjectId(), // Add a unique ObjectId for each order
            product,
            customerDetails,
            quantity,
            status: "pending", // Add default status for the order
            orderDate: new Date(),
          };

          const result = await usercollection.updateOne(
            { email },
            { $push: { orders: newOrder } }
          );

          if (result.modifiedCount === 1) {
            return res.status(200).json({
              success: true,
              message: "Order placed successfully for the user!",
              order: newOrder,
            });
          } else {
            return res.status(500).json({
              success: false,
              message: "Failed to update user's order data.",
            });
          }
        } else {
          // User does not exist, create an unknown order
          const unknownOrderCollection = db.collection("unknownOrder");
          const unknownOrder = {
            _id: new ObjectId(), // Add a unique ObjectId for unknown orders
            product,
            customerDetails,
            quantity,
            status: "pending", // Add default status for the order
            orderDate: new Date(),
          };

          const result = await unknownOrderCollection.insertOne(unknownOrder);

          if (result.insertedId) {
            return res.status(201).json({
              success: true,
              message: "Order placed successfully in unknown orders!",
              order: unknownOrder,
            });
          } else {
            return res.status(500).json({
              success: false,
              message: "Failed to create unknown order.",
            });
          }
        }
      } catch (error) {
        console.error("Error placing order:", error);
        res.status(500).json({
          success: false,
          message: "Something went wrong.",
          error: error.message,
        });
      }
    });

    // Fetch all orders (user orders and unknown orders)
    app.get("/api/admin/orders", async (req, res) => {
      try {
        // Fetch all user orders
        const usersWithOrders = await usercollection
          .find({ orders: { $exists: true, $ne: [] } }) // Match users with orders
          .project({ orders: 1 }) // Retrieve only the orders
          .toArray();

        // Flatten user orders
        const userOrders = usersWithOrders.flatMap((user) => user.orders);

        // Fetch all unknown orders
        const unknownOrders = await db
          .collection("unknownOrder")
          .find()
          .toArray();

        // Combine all orders
        const allOrders = [...userOrders, ...unknownOrders];

        res.status(200).json({
          success: true,
          orders: allOrders,
        });
      } catch (error) {
        console.error("Error fetching all orders:", error);
        res.status(500).json({
          success: false,
          message: "Failed to fetch all orders.",
          error: error.message,
        });
      }
    });

    app.get("/api/orders/:email", async (req, res) => {
      const { email } = req.params; // Get the email from the route parameter

      try {
        // Match the user by email and ensure orders exist
        const userWithOrders = await usercollection.findOne(
          { email: email, orders: { $exists: true, $ne: [] } },
          { projection: { orders: 1 } }
        );

        if (!userWithOrders) {
          return res
            .status(404)
            .json({ message: "No orders found for this user." });
        }

        // Return the user's orders
        const userOrders = userWithOrders.orders;

        res.status(200).json(userOrders);
      } catch (error) {
        console.error(error);
        res
          .status(500)
          .json({ message: "An error occurred while fetching orders." });
      }
    });

    // Confirm order (update status to "confirmed")
    app.patch("/api/orders/:orderId/confirm", async (req, res) => {
      const { orderId } = req.params;

      try {
        const objectId = new ObjectId(orderId);

        // Check if the order exists in the user's orders
        const resultUserOrder = await usercollection.updateOne(
          { "orders._id": objectId }, // Match the order by _id
          { $set: { "orders.$.status": "confirmed" } } // Update the status of the matched order
        );

        if (resultUserOrder.modifiedCount > 0) {
          return res.status(200).json({
            success: true,
            message: "Order confirmed in user orders!",
          });
        }

        // Check if the order exists in unknown orders
        const resultUnknownOrder = await db
          .collection("unknownOrder")
          .updateOne({ _id: objectId }, { $set: { status: "confirmed" } });

        if (resultUnknownOrder.modifiedCount > 0) {
          return res.status(200).json({
            success: true,
            message: "Order confirmed in unknown orders!",
          });
        }

        res.status(400).json({
          success: false,
          message: "Order not found or already confirmed.",
        });
      } catch (error) {
        console.error("Error confirming order:", error);
        res
          .status(500)
          .json({ success: false, message: "Failed to confirm the order." });
      }
    });

    app.delete("/api/orders/:orderId", async (req, res) => {
      const { orderId } = req.params;

      try {
        const objectId = new ObjectId(orderId);

        // Remove the order from user's orders array
        const resultUserOrder = await usercollection.updateOne(
          { "orders._id": objectId }, // Match the specific order in the array
          { $pull: { orders: { _id: objectId } } } // Remove the matched order from the array
        );

        if (resultUserOrder.modifiedCount > 0) {
          return res.status(200).json({
            success: true,
            message: "Order deleted from user orders!",
          });
        }

        // If not found in user's orders, delete it from unknownOrder collection
        const resultUnknownOrder = await db
          .collection("unknownOrder")
          .deleteOne({ _id: objectId });

        if (resultUnknownOrder.deletedCount > 0) {
          return res.status(200).json({
            success: true,
            message: "Order deleted from unknown orders!",
          });
        }

        // If no matching order was found
        res.status(404).json({
          success: false,
          message: "Order not found in user orders or unknown orders.",
        });
      } catch (error) {
        console.error("Error canceling (deleting) order:", error);
        res.status(500).json({
          success: false,
          message: "Failed to cancel (delete) the order.",
        });
      }
    });

    // delevary status ok funtion

    app.patch("/api/orders/deliver/:orderId", async (req, res) => {
      const { orderId } = req.params;

      // Validate the ObjectId
      if (!ObjectId.isValid(orderId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid order ID.",
        });
      }

      try {
        const objectId = new ObjectId(orderId);

        // Update deliveryStatus to true in user orders
        const resultUserOrder = await usercollection.updateOne(
          { "orders._id": objectId }, // Match the specific order
          { $set: { "orders.$.deliveryStatus": true } } // Set deliveryStatus to true
        );

        if (resultUserOrder.modifiedCount > 0) {
          return res.status(200).json({
            success: true,
            message: "Delivery status updated in user orders!",
          });
        }

        // Update deliveryStatus to true in unknown orders
        const resultUnknownOrder = await db
          .collection("unknownOrder")
          .updateOne(
            { _id: objectId }, // Match the specific order
            { $set: { deliveryStatus: true } } // Set deliveryStatus to true
          );

        if (resultUnknownOrder.modifiedCount > 0) {
          return res.status(200).json({
            success: true,
            message: "Delivery status updated in unknown orders!",
          });
        }

        res.status(404).json({
          success: false,
          message: "Order not found or delivery status already updated.",
        });
      } catch (error) {
        console.error("Error updating delivery status:", error);
        res.status(500).json({
          success: false,
          message: "Failed to update delivery status.",
        });
      }
    });

    // Start the server
    app.listen(port, () => {
      console.log(`Server is running on http://localhost:${port}`);
    });
  } finally {
    // Close the MongoDB connection when done
    await client.close();
  }
}

run().catch(console.dir);

// Test route
app.get("/", (req, res) => {
  const serverStatus = {
    message: "Server is running smoothly",
    timestamp: new Date(),
  };
  res.json(serverStatus);
});
