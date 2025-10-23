import { Client, GatewayIntentBits } from 'discord.js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { franc } from 'franc-min';
import { Readable } from 'stream';
import FormData from 'form-data';
import { channel } from 'diagnostics_channel';

dotenv.config();

const client = new Client({
    intents: [
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.Guilds,
      GatewayIntentBits.DirectMessages
    ],
    partials: ['CHANNEL'],
  });
  
client.once('clientReady', () => {
    console.log(`up to work ${client.user.tag}`);
});

const userStates = new Map();
const channelListMapping = new Map();
const channelUserMapping = new Map();
const engMessages = [
  "👋 Hi! What task or problem would you like to report? Please provide the url where the problem is happening",
  "Got it! Please provide a short title for this task.",
  "Great! now, could you attach any related evidence like screenshots or screen recordings?",
  "✅ Success! Your task has been created. Reference number:",
  "🚨 There was an error creating the task."
]
const spaMessages = [
  "👋 ¡Hola! ¿Qué tarea o problema te gustaría reportar? Por favor, recordá incluir la URL donde está ocurriendo el error",
  "Entendido, por favor aportá un breve título para esta tarea.",
  "¡Genial! Ahora, ¿podrías adjuntar alguna evidencia relacionada, como capturas de pantalla o grabaciones de pantalla?",
  "✅ Tu tarea ha sido creada. Número de referencia:",
  "🚨 Hubo un error al crear la tarea."
]

/**
 * Handle incoming messages
 * @param {Message} message - The message object
 */
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const userId = message.author.id;
    const userState = userStates.get(userId);

    // Handle configuration commands
    if (message.content.startsWith('--set-list')) {
        //if (!message.member?.permissions.has('ADMINISTRATOR')) {
        //    return message.reply('You need administrator permissions to use this command.');
        //}

        const args = message.content.split(' ');
        if (args.length !== 2) {
            return message.reply('❌ Invalid command format. Use: `--set-list {listID}`');
        }
        const listId = args[1];
        const channelName = message.channel.name;

        if (!listId || listId.length < 5) {
            return message.reply('❌ Please provide a valid clickup list ID.');
        }

        setChannelListId(message.channel.id, listId);
        return message.reply(`✅ Channel **${channelName}** is now mapped to ClickUp list ID: **${listId}**`);
    }

    // Handle list command to show current mappings
    if (message.content === '--list') {
        //if (!message.member?.permissions.has('ADMINISTRATOR')) {
        //    return message.reply('🚨 You need administrator permissions to use this command.');
        //}

        const mappings = getAllChannelMappings();
        if (Object.keys(mappings).length === 0) {
            return message.reply('📝 No channel mappings configured yet. Use `--set-list ID {listID}` to configure.');
        }

        let response = '📝 **Current Channel Mappings:**\n';
        for (const [channel, listId] of Object.entries(mappings)) {
            response += `• **${channel}**: \`${listId}\`\n`;
        }
        return message.reply(response);
    }

    if (message.content.startsWith('--set-assigned')){
      const args = message.content.split(' ');
      if (args.length !== 2) {
          return message.reply('❌ Invalid command format. Use: `--set-assigned {userId}`');
      }
      const clickUpUserId = args[1];
      const channelName = message.channel.name;

      if (!clickUpUserId || clickUpUserId.length < 4) {
          return message.reply('❌ Please provide a valid clickup user ID.');
      }

      setChannelUserId(message.channel.id, clickUpUserId);
      return message.reply(`✅ Channel **${channelName}** is now mapped to User: **${clickUpUserId}**`);
    }

    // Handle help command
    if (message.content === '--help') {
        const helpMessage = `🤖 **IT Help Bot - Available Commands**

**Configuration Commands:**
• \`--set-list {listID}\` - Configure ClickUp list ID for this channel
• \`--set-assigned {userId}\` - Set default assignee for tasks created in this channel
• \`--list\` - Show current channel mappings

**Usage:**
• \`--set-list 123456789\` - Maps this channel to ClickUp list ID 123456789
• \`--set-assigned 987654321\` - Sets ClickUp user ID 987654321 as default assignee
• \`--list\` - Displays all configured channel mappings

**Task Creation:**
Just start typing! The bot will guide you through creating a task with:
1. Problem description and URL
2. Task title
3. Evidence attachments (screenshots, recordings, etc.)

**Note:** Configuration commands should be run by administrators.`;

        return message.reply(helpMessage);
    }

    //1. first step 
    if (message.content.toLowerCase() !== '--list' && message.content.toLowerCase() !== '--set-list' && message.content.toLowerCase() !== '--help' && !message.content.toLowerCase().startsWith('--set-assigned') && !userStates.has(userId)) {
        var lang = franc(message.content.toLocaleLowerCase());
         if (/\b(hola|problema|tengo|gracias|adiós)\b/.test(message.content.toLocaleLowerCase())) lang = 'spa';
        userStates.set(userId, { step: 'init_conversation', lang: lang });

        return message.reply(lang === 'spa' ? spaMessages[0] : engMessages[0]);
    }
    //2. get details from user
    if (userState?.step === 'init_conversation') {
        userState.details = message.content;
        userState.step = 'awaiting_title';
        return message.reply(userState?.lang === 'spa' ? spaMessages[1] : engMessages[1]);
    }
    //3. get evidence from user
    if (userState?.step === 'awaiting_title') { 
        userState.title = message.content;
        userState.step = 'awaiting_evidence';
        return message.reply(userState?.lang === 'spa' ? spaMessages[2] : engMessages[2]);
    }
    // 4. handle attachments and send ticket to click up
    if (userState?.step === 'awaiting_evidence') {
        const attachments = [];
        const urls = [];

        // Check for file attachments
        if (message.attachments.size > 0) {
          message.attachments.forEach(attachment => {
            attachments.push({
              url: attachment.url,
              name: attachment.name,
              type: 'file'
            });
          });
        }
        
        // check for urls in message 
        if (message.content) {
          const urlRegex = /(https?:\/\/[^\s]+)/g;
          const foundUrls = message.content.match(urlRegex);
          if (foundUrls && foundUrls.length > 0) {
            foundUrls.forEach(url => {
              urls.push({
                url: url,
                name: 'External Link',
                type: 'url'
              });
            });
          }
        }
        try {
            // Get the appropriate ClickUp list ID based on channel
            const channel = message.channel.id ?? 'Direct Message';
            const channelName = message.channel.name;
            const clickUpListId = getClickUpListId(channel);
            const assignedId = getClickUpUserId(channel);
            console.log(assignedId);
            // Validate that we have a valid list ID
            if (clickUpListId == null) {
              await message.reply(`No ClickUp list configured for channel: ${channelName}. Use '--set-list {listID}' to configure this channel.`);
              throw Error();
            }
            
            // Create task in ClickUp
            const reporterInfo = `
            **Reporter:** ${message.author.username}#${message.author.discriminator}
            **User ID:** ${message.author.id}
            **Channel:** ${message.channel.name ?? 'Direct Message'}
            **Message link:** ${message.url}
            ---
            ${userState.details}
            `;
            const createTask = await fetch(`https://api.clickup.com/api/v2/list/${clickUpListId}/task`, {
              method: 'POST',
              headers: {
                'Authorization': process.env.CLICKUP_TOKEN,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                name: userState.title,
                description: reporterInfo,
              }),
            });
      
            const taskData = await createTask.json();
            if(assignTask != null) await assignTask(taskData.Id, assignedId)
            // Process all attachments (files and URLs)
            const allAttachments = [...attachments, ...urls];
            let uploadResults = null;
            
            if (taskData.id && allAttachments.length > 0) {
              uploadResults = await uploadMultipleAttachments(taskData.id, allAttachments);
              
              // Update task description with URLs if any
              const urlAttachments = allAttachments.filter(att => att.type === 'url');
              if (urlAttachments.length > 0) {
                const urlList = urlAttachments.map(att => `- ${att.url}`).join('\n');
                const updatedDescription = `${reporterInfo}\n\n**Evidence Links Provided By User:**\n${urlList}`;
                
                const updateResponse = await fetch(`https://api.clickup.com/api/v2/task/${taskData.id}`, {
                  method: 'PUT',
                  headers: {
                    'Authorization': process.env.CLICKUP_TOKEN,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ description: updatedDescription }),
                });
                uploadResult = await updateResponse.json();
              }
            }
            
            await message.reply(userState?.lang === 'spa' ? spaMessages[3]+` **${taskData.id}**` : engMessages[3]+` **${taskData.id}**`);
          } catch (err) {
            console.error(err);
            await message.reply(userState?.lang === 'spa' ? spaMessages[4] : engMessages[4]);
          }
      
          userStates.delete(userId);
      }
});

/**
 * Gets click up list id for a given channel
 * @param {string} channelId - The name of the Discord channel
 * @returns {string|null} The clickup list id or null if not configured
 */
function getClickUpListId(channelId) {
  if (channelListMapping.has(channelId)) {
    return channelListMapping.get(channelId);
  }
  return null;
}

/**
 * Set a ClickUp list ID for a specific channel
 * @param {string} channelId - The name of the Discord channel
 * @param {string} listId - The ClickUp list ID
 */
function setChannelListId(channelId, listId) {
  channelListMapping.delete(channelId);
  channelListMapping.set(channelId, listId);
}

/**
 * Set a ClickUp list ID for a specific channel
 * @param {string} channelId - The name of the Discord channel
 * @param {string} user - The ClickUp user ID
 */
function setChannelUserId(channelId, userId) {
  channelUserMapping.delete(channelId);
  channelUserMapping.set(channelId, userId);
}

/**
 * Gets click up user id assigned for a given channel
 * @param {string} channelId - The name of the Discord channel
 * @returns {string|null} The clickup user id or null if not configured
 */
function getClickUpUserId(channelId) {
  if (channelUserMapping.has(channelId)) {
    return channelUserMapping.get(channelId);
  }
  return null;
}

/**
 * Get all configured channel mappings
 * @returns {Object} Object with channel mappings
 */
function getAllChannelMappings() {
  const mappings = {};
  for (const [channel, listId] of channelListMapping.entries()) {
    mappings[channel] = listId;
  }
  return mappings;
}

async function uploadAttachment(taskId, attachmentUrl, fileName) {
  try {
    // Download the file from Discord
    const fileResponse = await fetch(attachmentUrl);
    if (!fileResponse.ok) throw new Error(`Failed to fetch file: ${fileResponse.statusText}`);
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    // Wrap in a Readable stream for FormData
    const fileStream = Readable.from(fileBuffer);

    const form = new FormData();
    form.append('attachment', fileStream, { filename: fileName });

    const uploadRes = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, {
      method: 'POST',
      headers: {
        'Authorization': process.env.CLICKUP_TOKEN,
        ...form.getHeaders()
      },
      body: form
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(`ClickUp attachment error: ${JSON.stringify(uploadData)}`);
    
    return { success: true, data: uploadData, fileName };

  } catch (err) {
    console.error(`Error uploading attachment ${fileName}:`, err);
    return { success: false, error: err.message, fileName };
  }
}

/**
 * Upload multiple attachments to ClickUp
 * @param {string} taskId - The ClickUp task ID
 * @param {Array} attachments - Array of attachment objects
 * @returns {Object} Upload results
 */
async function uploadMultipleAttachments(taskId, attachments) {
  const results = {
    successful: [],
    failed: [],
    total: attachments.length
  };

  // Process attachments in parallel with limited concurrency
  const concurrency = 3; // Upload max 3 files at once
  for (let i = 0; i < attachments.length; i += concurrency) {
    const batch = attachments.slice(i, i + concurrency);
    
    const batchPromises = batch.map(async (attachment) => {
      if (attachment.type === 'file') {
        return await uploadAttachment(taskId, attachment.url, attachment.name);
      } else if (attachment.type === 'url') {
        // For URLs, we'll add them to the description instead of uploading
        return { success: true, data: null, fileName: attachment.name, url: attachment.url, type: 'url' };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(result => {
      if (result && result.success) {
        results.successful.push(result);
      } else if (result) {
        results.failed.push(result);
      }
    });
  }

  return results;
}

/**
 * Assigns task to the user already setted
 * @param {*} taskId 
 * @param {*} userId 
 */
async function assignTask(taskId, userId) {
  await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: 'PUT',
    headers: {
      'Authorization': process.env.CLICKUP_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assignees: [String(userId)],
    }),
  });
}
// start client
client.login(process.env.DISCORD_TOKEN).catch(console.error);
  
  