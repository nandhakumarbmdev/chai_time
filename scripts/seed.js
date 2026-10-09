import 'dotenv/config';
import { connectDB } from '../config/db.js';
import Member from '../models/Member.js';
import MenuItem from '../models/MenuItem.js';

const MEMBERS = [
  'Nandhakumar', 'Kamalesh', 'Sudhan', 'Yeshwanth', 'Raja',
  'Bhavadharani', 'Hesham', 'Yuvaraj', 'Mukundan', 'Yaser',
  'Rithika',
];

const MENU_ITEMS = [
  { name: 'Tea', emoji: '🍵', category: 'hot', description: 'Classic masala chai', sortOrder: 1 },
  { name: 'Coffee', emoji: '☕', category: 'hot', description: 'Filter coffee', sortOrder: 2 },
  { name: 'Badam Milk', emoji: '🥛', category: 'hot', description: 'Warm almond milk', sortOrder: 3 },
  { name: 'Milk', emoji: '🍼', category: 'hot', description: 'Plain warm milk', sortOrder: 4 },
  { name: 'Black Coffee', emoji: '🖤', category: 'hot', description: 'Strong & bold', sortOrder: 5 },
];

async function seed() {
  await connectDB();

  // Remove Green Tea if present
  await MenuItem.deleteMany({ name: 'Green Tea' });

  // Members
  let membersCreated = 0;
  for (const name of MEMBERS) {
    const exists = await Member.findOne({ name });
    if (!exists) {
      await Member.create({ name });
      membersCreated++;
    }
  }
  console.log(`✅ Members: ${membersCreated} created, ${MEMBERS.length - membersCreated} already existed`);

  // Menu items
  let menuCreated = 0;
  for (const item of MENU_ITEMS) {
    const exists = await MenuItem.findOne({ name: item.name });
    if (!exists) {
      await MenuItem.create(item);
      menuCreated++;
    }
  }
  console.log(`✅ Menu items: ${menuCreated} created, ${MENU_ITEMS.length - menuCreated} already existed`);

  console.log('🌱 Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
