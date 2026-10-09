import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('❌ MONGODB_URI environment variable is missing.');
    process.exit(1);
  }

  // Strictly disallow localhost / 127.0.0.1 - cloud database only
  if (uri.includes('localhost') || uri.includes('127.0.0.1')) {
    console.error(
      '❌ Localhost MongoDB is disabled. Chai Time must connect to Cloud MongoDB (MongoDB Atlas) only.'
    );
    process.exit(1);
  }

  try {
    await mongoose.connect(uri, {
      dbName: 'break_buddy',
    });
    console.log('✅ Cloud MongoDB Atlas connected successfully');
  } catch (err) {
    console.error('❌ Cloud MongoDB connection failed:', err.message);
    process.exit(1);
  }
}
