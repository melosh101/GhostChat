const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');

// AES-256-CBC encryption setup
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const key = process.env.KEY;
console.log('KEY:', key);

const ENCRYPTION_KEY = crypto.createHash('sha256')
  .update(key)
  .digest('base64').substr(0, 32); // Hash the key to ensure it's 32 bytes long


// Function to encrypt data
function encrypt(text) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// Function to decrypt data
function decrypt(text) {
  const parts = text.split(':');
  const iv = Buffer.from(parts.shift(), 'hex');
  const encryptedText = parts.join(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}


let socketRooms = {};


// SQLite database setup
// 1. Remember to change the path. 
// 2. Be careful if you want to put .db in your workspace because some local server extensions in vscode make the site refresh when binard code is changed.


// Define the absolute path where the database will be stored, including the file name 'database.db'
const absoluteDbPath = path.resolve('C:\\Users\\ahme1636\\Desktop', 'database.db');

// Initialize the SQLite database
let db = new sqlite3.Database(absoluteDbPath, (err) => {
  if (err) {
    console.error('Error opening database at path:', absoluteDbPath, '\n', err.message);
  } else {
    console.log('Connected to the SQLite database at:', absoluteDbPath);
  }
});

async function initializeAllTables() {
  return new Promise((resolve, reject) => {
    const queries = [
      `CREATE TABLE IF NOT EXISTS Users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        avatar TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS Posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message TEXT NOT NULL,
        user_id INTEGER,
        channel_id INTEGER,
        FOREIGN KEY (user_id) REFERENCES Users(id),
        FOREIGN KEY (channel_id) REFERENCES Channels(id)
      )`,

      `CREATE TABLE IF NOT EXISTS Channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        Channel_name TEXT UNIQUE NOT NULL,
        private BOOLEAN DEFAULT 0
      )`,

      `CREATE TABLE IF NOT EXISTS PublicChannels (
        channel_id INTEGER,
        channel_name TEXT,
        FOREIGN KEY (channel_id) REFERENCES Channels(id)
      )`,

      `CREATE TABLE IF NOT EXISTS PrivateChannels (
        channel_id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_name TEXT UNIQUE NOT NULL,
        user_id1 INTEGER,
        user_id2 INTEGER,
        FOREIGN KEY (user_id1) REFERENCES Users(id),
        FOREIGN KEY (user_id2) REFERENCES Users(id)
      )`
    ];

    queries.forEach((query, index) => {
      db.run(query, (err) => {
        if (err) {
          console.error(`Error creating table ${index + 1}:`, err.message);
          reject(err);
        } else {
          console.log(`Successfully created table ${index + 1}`);
        }
      });
    });
    resolve();
  });
}




async function savePost(message, user_id, channel_id) {
  return new Promise((resolve, reject) => {
    const query = `
        INSERT INTO Posts (message, user_id, channel_id)
        VALUES (?, ?, ?);
        `;

    db.run(query, [message, user_id, channel_id], function (err) {
      if (err) {
        console.error(`Error:`, err.message);
        reject(err);
      } else {
        console.log("Successfully saved post");
        resolve();
      }
    });
  });
}

async function saveUser(username, password, avatar) {
  return new Promise((resolve) => {
    const query = `
        INSERT INTO Users (username, password, avatar)
        VALUES (?, ?, ?);
    `;
    db.run(query, [username, password, avatar], function (err) {
      if (err) {
        console.error(`Error:`, err.message);
        resolve(false); // Return false on error
      } else {
        console.log("Successfully saved user");
        resolve(true); // Return true on success
      }
    });
  });
}

async function getUser(username, password) {
  return new Promise((resolve, reject) => {
    const query = `
        SELECT * FROM Users
        WHERE username = ? AND password = ?;
    `;
    db.get(query, [username, password], (err, row) => {
      if (err) {
        console.error(`Error:`, err.message);
        reject(false); // On error, reject with false
      } else {
        if (row) {
          console.log("User exists and password is correct");
          resolve(true); // User exists and password matches
        } else {
          console.log("User does not exist or password is incorrect");
          resolve(false); // User doesn't exist or password doesn't match
        }
      }
    });
  });
}

async function checkForChannelName(tableName, username) {   
  return new Promise((resolve, reject) => {

    const one = username + tableName;
    const two = tableName + username;

    const query = `
        SELECT * FROM Channels WHERE Channel_name IN (?, ?, ?);
    `;
    db.get(query, [tableName, one, two], (err, row) => {
      if (err) {
        console.error(`Error:`, err.message);
        reject(err);
      } else {
        if (row) {
          console.log(`Row with Channel_name "${tableName}" exists`);
          // Return both the existence status and the 'private' attribute value if it exists
          resolve({ exists: true, private: row.private });
        } else {
          console.log(`Row with Channel_name "${tableName}" does not exist`);
          resolve({ exists: false });
        }
      }
    });
  });
}






async function isTheRoomAUser(roomName) {
  return new Promise((resolve, reject) => {
    const query = `
        SELECT * FROM Users WHERE username = ?;
    `;
    db.get(query, [roomName], (err, row) => {
      if (err) {
        console.error(`Error:`, err.message);
        reject(err);
      } else {
        if (row) {
          console.log(`Row with username "${roomName}" exists`);
          resolve(true);
        } else {
          console.log(`Row with username "${roomName}" does not exist`);
          resolve(false);
        }
      }
    });
  });

}

function generateRandomRoomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      result += characters[randomIndex];
  }
  return result;
}






async function savePrivateChannel(channelName, user_id1, user_id2) {
  return new Promise((resolve, reject) => {
    const query = `
        INSERT INTO PrivateChannels (channel_name, user_id1, user_id2)
        VALUES (?, ?, ?);
    `;
    db.run(query, [channelName, user_id1, user_id2], function (err) {
      if (err) {
        console.error(`Error:`, err.message);
        reject(err);
      } else {
        console.log("Successfully saved private channel");
        resolve();
      }
    });
  });
}

async function saveToChannels(channelName, private) {
  return new Promise((resolve, reject) => {
    const query = `
        INSERT INTO Channels (Channel_name, private)
        VALUES (?, ?);
    `;
    db.run(query, [channelName, private], function (err) {
      if (err) {
        console.error(`Error:`, err.message);
        reject(err);
      } else {
        console.log("Successfully saved to channels");
        resolve();
      }
    });
  });

}






// Socket.IO setup
const io = new Server(3000, {
  cors: {
    origin: ["http://127.0.0.1:5501", "http://localhost:5500"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

function generateRoomName(user1, user2){
  return user1 + user2;
}

io.on('connection', (socket) => {
  console.log(`Client connected with id: ${socket.id}`);

  socket.on('joinRoom', async (data) => {
    const {roomName, username, password} = data;
    console.log(`${socket.id} trying to join room: ${data.roomName}`);
    try {
        if (socketRooms[socket.id]) {
            const previousRoom = socketRooms[socket.id];
            socket.leave(previousRoom);
            console.log(`${socket.id} left room: ${previousRoom}`);
        }

        // this will later on be called: socket.join(roomName);
        // this will later on be called: socketRooms[socket.id] = roomName;
        




        const { exists, private: privateValue } = await checkForChannelName(roomName);

        
        if (exists) {
            if (privateValue) {
              console.log("Alright everything went chill you can proceed with public side")
               socket.join(roomName);  // join user to this room/channel
                // give him earlier messages
          
            }else {
              socket.join(roomName); // join user to this room/channel
                // give him earlier messages
            }
          }
        else {
            // Check if the room is a user
            const isUser = await isTheRoomAUser(roomName);
            if (isUser) {
                const generatedRoomName = generateRoomName(username, roomName);// generate new 8 didgit room/table name
                savePrivateChannel(generatedRoomName, roomName, username );// create a new channel with this name
                saveToChannels(generatedRoomName, true);// create a new channel with this name
                socket.join(roomName);// join user to this room/channel
            } else {
                // generate new channel dirrectly with this roomName
                // join user to this room/channel
            }
        }











        /*
        const messages = await getData(roomName);

        if (messages && messages.length > 0) {
          messages.forEach((message) => {
            socket.emit('message', [message.avatar, message.name, message.post]);
          });
          console.log(`${socket.id} has received previous messages for room "${roomName}"`);
        } else {
          console.log(`No messages found in room "${roomName}".`);
          socket.emit('message', ["Resources/admin.webp", "System", "No messages yet in this room."]);
        }
        */
    } catch (err) {
        console.error(`Error in 'joinRoom' for room "${roomName}":`, err.message);
    }
  });

  socket.on('sendMessage', async (roomName, message) => {
    console.log(`Received message in room "${roomName}" from client ${socket.id}:`, message);
    try {
        if (!roomName || !message || message.length < 3) {
            throw new Error('Invalid message format or missing room');
        }

        const [messageText, username, avatar] = message;  // Ensure correct destructuring
        await checkForChannelName(roomName);  // Ensure the table exists for the room
        //await insertData(roomName, { avatar, name: username, post: messageText });  

        // Emit the message to all clients in the room, including the sender
        socket.to(roomName).emit('message', [avatar, username, messageText]);  // Correct order: [avatar, name, post]
        socket.emit('message', [avatar, username, messageText]);  // Send the message back to the sender in the correct order

        console.log(`Message from ${socket.id} successfully sent in room "${roomName}"`);
    } catch (err) {
        console.error(`Error in 'sendMessage' for room "${roomName}":`, err.message);
    }
  });

  socket.on('leaveRoom', (roomName) => {
    console.log(`${socket.id} is leaving room: ${roomName}`);
    try {
      socket.leave(roomName);
      socketRooms[socket.id] = null;
      console.log(`${socket.id} left room: ${roomName}`);
    } catch (err) {
      console.error(`Error in 'leaveRoom' for room "${roomName}":`, err.message);
    }
  });

  socket.on('register', async (data, callback) => {
    const { username, password, profileImage } = data;
    console.log(`Received registration request for user: ${username}`);

    try {
      const user = await saveUser(username, password, profileImage);
      if (user) {
        callback({ success: true, user });
        console.log(`User ${username} successfully registered`);
      } else {
        callback({ success: false, message: 'Registration failed' });
        console.log(`User ${username} registration failed`);
      }
    } catch (err) {
      console.error(`Error in 'register' for user "${username}":`, err.message);
      callback({ success: false, message: err.message });
    }
  });

  socket.on('login', async (data, callback) => {
    const { username, password } = data;
    console.log(`Received login request for user: ${username}`);

    try {
      const user = await getUser(username, password);
      if (user) {
        callback({ success: true, user });
        console.log(`User ${username} successfully logged in`);
      } else {
        callback({ success: false, message: 'Login failed' });
        console.log(`User ${username} login failed`);
      }
    } catch (err) {
      console.error(`Error in 'login' for user "${username}":`, err.message);
      callback({ success: false, message: err.message });
    }
  });
});




initializeAllTables();

