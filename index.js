require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const {
  initDatabase,
  ensureUser,
  adjustRelationshipScore,
  getRelationshipScore,
  listSpouses,
  relationshipBar,
  canDate,
  canPropose,
  getMarriageCount,
  MAX_MARRIAGES,
  findMarriageBetween,
  removeMarriage,
} = require("./relationship");
const dialogue = require("./dialogue");
const { runDate } = require("./date");
const { runCeremony } = require("./ceremony");

const { DISCORD_TOKEN, CLIENT_ID } = process.env;

if (!DISCORD_TOKEN) {
  throw new Error("Missing DISCORD_TOKEN in environment (.env).");
}
if (!CLIENT_ID) {
  throw new Error("Missing CLIENT_ID in environment (.env).");
}

initDatabase();

const COZY_COLOR = 0xf4a7b9;
const CUSTOM_ID_PREFIX = "cozybot:";

const pendingFlirts = new Map();
const pendingDateInvites = new Map();
const pendingProposals = new Map();

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatLine(template, senderMention, targetMention) {
  return template
    .replaceAll("{sender}", senderMention)
    .replaceAll("{target}", targetMention);
}

function makeNonce() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeFlirtCustomId(action, nonce) {
  return `${CUSTOM_ID_PREFIX}flirt:${action}:${nonce}`;
}

function makeDateCustomId(action, nonce) {
  return `${CUSTOM_ID_PREFIX}date:${action}:${nonce}`;
}

function makeProposeCustomId(action, nonce) {
  return `${CUSTOM_ID_PREFIX}propose:${action}:${nonce}`;
}

async function timeoutFlirt(nonce, client) {
  const pending = pendingFlirts.get(nonce);
  if (!pending) return;
  pendingFlirts.delete(nonce);

  try {
    const channel = await client.channels.fetch(pending.channelId);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(pending.messageId);

    const embed = EmbedBuilder.from(message.embeds?.[0] ?? null).setColor(COZY_COLOR);
    embed.setFooter({ text: "💌 Timed out — no response." });
    embed.addFields({
      name: "Result",
      value: pick(dialogue.flirtTimeout),
    });

    await message.edit({ embeds: [embed], components: [] });
  } catch {
    // Best-effort timeout cleanup.
  }
}

async function handleFlirtCommand(interaction) {
  const target = interaction.options.getUser("user", true);
  const sender = interaction.user;

  if (target.bot) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 That’s a cute idea, but bots are immune to cozy feelings.",
    });
    return;
  }
  if (target.id === sender.id) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 You can’t flirt with yourself… but I respect the confidence.",
    });
    return;
  }

  ensureUser(sender.id, sender.username);
  ensureUser(target.id, target.username);

  const nonce = makeNonce();
  const acceptId = makeFlirtCustomId("accept", nonce);
  const rejectId = makeFlirtCustomId("reject", nonce);

  const embed = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("🌹 A cozy flirt appears")
    .setDescription(
      formatLine(pick(dialogue.flirtLines), `<@${sender.id}>`, `<@${target.id}>`)
    )
    .addFields({
      name: "🌡 Current relationship score",
      value: `${getRelationshipScore(sender.id, target.id)}/100`,
      inline: true,
    })
    .setFooter({ text: "Target has 60 seconds to respond." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(acceptId)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(rejectId)
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
  );

  const message = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true,
    allowedMentions: { users: [sender.id, target.id] },
  });

  pendingFlirts.set(nonce, {
    nonce,
    senderId: sender.id,
    targetId: target.id,
    channelId: interaction.channelId,
    messageId: message.id,
    createdAt: Date.now(),
    timeoutHandle: setTimeout(() => timeoutFlirt(nonce, interaction.client), 60_000),
  });
}

async function timeoutDateInvite(nonce, client) {
  const pending = pendingDateInvites.get(nonce);
  if (!pending) return;
  pendingDateInvites.delete(nonce);

  try {
    const channel = await client.channels.fetch(pending.channelId);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(pending.messageId);

    const embed = EmbedBuilder.from(message.embeds?.[0] ?? null).setColor(COZY_COLOR);
    embed.setFooter({ text: "💌 Timed out — no response." });
    embed.addFields({
      name: "Result",
      value: formatLine(
        pick(dialogue.dateDeclined),
        `<@${pending.inviterId}>`,
        `<@${pending.inviteeId}>`
      ),
    });

    await message.edit({ embeds: [embed], components: [] });
  } catch {
    // Best-effort timeout cleanup.
  }
}

async function handleDateCommand(interaction) {
  const invitee = interaction.options.getUser("user", true);
  const inviter = interaction.user;

  if (invitee.bot) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 That’s sweet, but bots can’t go on dates.",
    });
    return;
  }
  if (invitee.id === inviter.id) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 A solo date is valid, but Cozybot needs two people for this one.",
    });
    return;
  }

  ensureUser(inviter.id, inviter.username);
  ensureUser(invitee.id, invitee.username);

  const gate = canDate(inviter.id, invitee.id);
  if (!gate.ok) {
    await interaction.reply({
      ephemeral: true,
      content: `💌 You two aren't quite there yet… (need **${gate.required}+**, currently **${gate.score}**).`,
    });
    return;
  }

  const nonce = makeNonce();
  const acceptId = makeDateCustomId("accept", nonce);
  const declineId = makeDateCustomId("decline", nonce);

  const inviterMention = `<@${inviter.id}>`;
  const inviteeMention = `<@${invitee.id}>`;

  const embed = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("💐 Date Invite")
    .setDescription(formatLine(pick(dialogue.dateInvites), inviterMention, inviteeMention))
    .setFooter({ text: "Invitee has 60 seconds to respond." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(acceptId)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(declineId)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Secondary)
  );

  const message = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true,
    allowedMentions: { users: [inviter.id, invitee.id] },
  });

  pendingDateInvites.set(nonce, {
    nonce,
    inviterId: inviter.id,
    inviteeId: invitee.id,
    channelId: interaction.channelId,
    messageId: message.id,
    createdAt: Date.now(),
    timeoutHandle: setTimeout(
      () => timeoutDateInvite(nonce, interaction.client),
      60_000
    ),
  });
}

async function timeoutProposal(nonce, client) {
  const pending = pendingProposals.get(nonce);
  if (!pending) return;
  pendingProposals.delete(nonce);

  try {
    const channel = await client.channels.fetch(pending.channelId);
    if (!channel || !channel.isTextBased()) return;
    const message = await channel.messages.fetch(pending.messageId);

    const embed = EmbedBuilder.from(message.embeds?.[0] ?? null).setColor(COZY_COLOR);
    embed.setFooter({ text: "💌 Timed out — no response." });
    embed.addFields({
      name: "Result",
      value: "🕯 The proposal hangs in the air… then fades.",
    });
    await message.edit({ embeds: [embed], components: [] });
  } catch {
    // Best-effort timeout cleanup.
  }
}

async function handleProposeCommand(interaction) {
  const target = interaction.options.getUser("user", true);
  const proposer = interaction.user;

  if (target.bot) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 Bots can’t accept proposals (yet).",
    });
    return;
  }
  if (target.id === proposer.id) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 You can’t propose to yourself—save that ring for someone special.",
    });
    return;
  }

  ensureUser(proposer.id, proposer.username);
  ensureUser(target.id, target.username);

  const gate = canPropose(proposer.id, target.id);
  if (!gate.ok) {
    await interaction.reply({
      ephemeral: true,
      content: `💌 You two aren't quite there yet… (need **${gate.required}+**, currently **${gate.score}**).`,
    });
    return;
  }

  const proposerMarriages = getMarriageCount(proposer.id);
  const targetMarriages = getMarriageCount(target.id);
  if (proposerMarriages >= MAX_MARRIAGES || targetMarriages >= MAX_MARRIAGES) {
    await interaction.reply({
      ephemeral: true,
      content: `💌 One of you has reached the marriage limit (**${MAX_MARRIAGES}**).`,
    });
    return;
  }

  const nonce = makeNonce();
  const acceptId = makeProposeCustomId("accept", nonce);
  const declineId = makeProposeCustomId("decline", nonce);

  const proposerMention = `<@${proposer.id}>`;
  const targetMention = `<@${target.id}>`;

  const embed = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("💍 A Proposal")
    .setDescription(formatLine(pick(dialogue.proposeLines), proposerMention, targetMention))
    .setFooter({ text: "Target has 60 seconds to respond." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(acceptId)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(declineId)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Secondary)
  );

  const message = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true,
    allowedMentions: { users: [proposer.id, target.id] },
  });

  pendingProposals.set(nonce, {
    nonce,
    proposerId: proposer.id,
    targetId: target.id,
    channelId: interaction.channelId,
    messageId: message.id,
    createdAt: Date.now(),
    timeoutHandle: setTimeout(() => timeoutProposal(nonce, interaction.client), 60_000),
  });
}

async function handleDivorceCommand(interaction) {
  const target = interaction.options.getUser("user", true);
  const sender = interaction.user;

  if (target.bot) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 Bots can’t be married, so there’s nothing to dissolve.",
    });
    return;
  }
  if (target.id === sender.id) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 You can’t divorce yourself (and I’m glad you asked anyway).",
    });
    return;
  }

  ensureUser(sender.id, sender.username);
  ensureUser(target.id, target.username);

  const existing = findMarriageBetween(sender.id, target.id);
  if (!existing) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 You two aren’t married… so there’s nothing to divorce.",
    });
    return;
  }

  const removed = removeMarriage(sender.id, target.id);
  if (!removed) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 I couldn’t finalize that divorce. Try again in a moment.",
    });
    return;
  }

  const res = adjustRelationshipScore(sender.id, target.id, -20);
  const senderMention = `<@${sender.id}>`;
  const targetMention = `<@${target.id}>`;

  const embed = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("🕯 Divorce")
    .setDescription(formatLine(pick(dialogue.divorceLines), senderMention, targetMention))
    .addFields(
      {
        name: "Pair",
        value: `${senderMention} + ${targetMention}`,
      },
      {
        name: "🌡 Relationship score",
        value: `${res.after}/100  (**${res.delta}**)`,
      }
    );

  await interaction.reply({
    embeds: [embed],
    allowedMentions: { users: [sender.id, target.id] },
  });
}

async function handleComplimentCommand(interaction) {
  const target = interaction.options.getUser("user", true);
  const sender = interaction.user;

  if (target.bot) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 Bots appreciate the thought… but it doesn’t quite land.",
    });
    return;
  }
  if (target.id === sender.id) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 Self-love is cozy, but try pointing that sweetness at someone else.",
    });
    return;
  }

  ensureUser(sender.id, sender.username);
  ensureUser(target.id, target.username);

  const delta = randInt(5, 8);
  const res = adjustRelationshipScore(sender.id, target.id, delta);

  const senderMention = `<@${sender.id}>`;
  const targetMention = `<@${target.id}>`;

  const embed = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("💌 A compliment, gently delivered")
    .setDescription(formatLine(pick(dialogue.complimentLines), senderMention, targetMention))
    .addFields({
      name: "🌡 Relationship score",
      value: `${res.after}/100  (**+${res.delta}**)`,
    });

  await interaction.reply({
    embeds: [embed],
    allowedMentions: { users: [sender.id, target.id] },
  });
}

async function handleInsultCommand(interaction) {
  const target = interaction.options.getUser("user", true);
  const sender = interaction.user;

  if (target.bot) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 Bots can’t be insulted… but I admire the commitment.",
    });
    return;
  }
  if (target.id === sender.id) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 Be a little kinder to yourself, okay?",
    });
    return;
  }

  ensureUser(sender.id, sender.username);
  ensureUser(target.id, target.username);

  const delta = randInt(8, 12) * -1;
  const res = adjustRelationshipScore(sender.id, target.id, delta);

  const senderMention = `<@${sender.id}>`;
  const targetMention = `<@${target.id}>`;

  const embed = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("🕯 An insult, tossed like a match")
    .setDescription(formatLine(pick(dialogue.insultLines), senderMention, targetMention))
    .addFields({
      name: "🌡 Relationship score",
      value: `${res.after}/100  (**${res.delta}**)`,
    });

  await interaction.reply({
    embeds: [embed],
    allowedMentions: { users: [sender.id, target.id] },
  });
}

function formatDiscordTimestamp(dateString) {
  const ms = Date.parse(dateString);
  if (!Number.isFinite(ms)) return null;
  return `<t:${Math.floor(ms / 1000)}:D>`;
}

async function handleStatusCommand(interaction) {
  const user1 = interaction.options.getUser("user", true);
  const user2 = interaction.options.getUser("user2", false);

  ensureUser(user1.id, user1.username);
  if (user2) ensureUser(user2.id, user2.username);

  if (user2) {
    if (user1.id === user2.id) {
      await interaction.reply({
        ephemeral: true,
        content: "💌 I can confirm that you... Are sort of in a relationship with... yourself.",
      });
      return;
    }

    const score = getRelationshipScore(user1.id, user2.id);
    const bar = relationshipBar(score);

    const embed = new EmbedBuilder()
      .setColor(COZY_COLOR)
      .setTitle("🌡 Relationship Status")
      .setDescription(`${bar}  ${score}/100`)
      .addFields({
        name: "Pair",
        value: `<@${user1.id}> + <@${user2.id}>`,
      })
      .setFooter({ text: pick(dialogue.statusQuips) });

    await interaction.reply({
      embeds: [embed],
      allowedMentions: { users: [user1.id, user2.id] },
    });
    return;
  }

  const spouses = listSpouses(user1.id);
  const spouseLines =
    spouses.length === 0
      ? "None (currently keeping it cozy-solo)."
      : spouses
          .map((s) => {
            const ts = formatDiscordTimestamp(s.marriedAt);
            return ts ? `💍 <@${s.spouseId}> — married ${ts}` : `💍 <@${s.spouseId}>`;
          })
          .join("\n");

  const embed = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("💌 Cozy Profile")
    .setDescription(`Profile for <@${user1.id}>`)
    .addFields(
      { name: "Spouses", value: spouseLines },
      { name: "Vibe", value: pick(dialogue.statusQuips) }
    );

  await interaction.reply({
    embeds: [embed],
    allowedMentions: { users: [user1.id, ...spouses.map((s) => s.spouseId)] },
  });
}

async function handleFlirtButton(interaction) {
  const [prefix, kind, action, nonce] = interaction.customId.split(":");
  if (prefix !== "cozybot" || kind !== "flirt") return false;
  if (!nonce) return true;

  const pending = pendingFlirts.get(nonce);
  if (!pending) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 That moment has already passed.",
    });
    return true;
  }

  if (interaction.user.id !== pending.targetId) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 These buttons are just for the person being flirted with.",
    });
    return true;
  }

  clearTimeout(pending.timeoutHandle);
  pendingFlirts.delete(nonce);

  ensureUser(pending.senderId, null);
  ensureUser(pending.targetId, null);

  const senderMention = `<@${pending.senderId}>`;
  const targetMention = `<@${pending.targetId}>`;

  const embed = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("🌹 A cozy flirt appears");

  if (action === "accept") {
    const delta = randInt(12, 18);
    const res = adjustRelationshipScore(pending.senderId, pending.targetId, delta);
    embed.setDescription(`${senderMention} → ${targetMention}`);
    embed.addFields(
      { name: "Result", value: formatLine(pick(dialogue.flirtAccepted), senderMention, targetMention) },
      {
        name: "🌡 Relationship score",
        value: `${res.after}/100  (**+${res.delta}**)`,
      }
    );
    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }

  if (action === "reject") {
    const res = adjustRelationshipScore(pending.senderId, pending.targetId, -5);
    embed.setDescription(`${senderMention} → ${targetMention}`);
    embed.addFields(
      { name: "Result", value: formatLine(pick(dialogue.flirtRejected), senderMention, targetMention) },
      {
        name: "🌡 Relationship score",
        value: `${res.after}/100  (**${res.delta}**)`,
      }
    );
    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }

  await interaction.reply({
    ephemeral: true,
    content: "💌 I didn’t understand that response button.",
  });
  return true;
}

async function handleDateInviteButton(interaction) {
  const [prefix, kind, action, nonce] = interaction.customId.split(":");
  if (prefix !== "cozybot" || kind !== "date") return false;
  if (!nonce) return true;

  const pending = pendingDateInvites.get(nonce);
  if (!pending) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 That invite has already passed.",
    });
    return true;
  }

  if (interaction.user.id !== pending.inviteeId) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 These buttons are just for the invited person.",
    });
    return true;
  }

  clearTimeout(pending.timeoutHandle);
  pendingDateInvites.delete(nonce);

  const inviterMention = `<@${pending.inviterId}>`;
  const inviteeMention = `<@${pending.inviteeId}>`;

  if (action === "decline") {
    const embed = new EmbedBuilder()
      .setColor(COZY_COLOR)
      .setTitle("💐 Date Invite")
      .addFields({
        name: "Result",
        value: formatLine(pick(dialogue.dateDeclined), inviterMention, inviteeMention),
      });

    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }

  if (action === "accept") {
    const embed = new EmbedBuilder()
      .setColor(COZY_COLOR)
      .setTitle("💐 Date Accepted")
      .setDescription(`${inviterMention} + ${inviteeMention}`)
      .setFooter({ text: "Settling in…" });

    await interaction.update({ embeds: [embed], components: [] });
    await runDate({
      message: interaction.message,
      inviterId: pending.inviterId,
      inviteeId: pending.inviteeId,
    });
    return true;
  }

  await interaction.reply({
    ephemeral: true,
    content: "💌 I didn’t understand that response button.",
  });
  return true;
}

async function handleProposeButton(interaction) {
  const [prefix, kind, action, nonce] = interaction.customId.split(":");
  if (prefix !== "cozybot" || kind !== "propose") return false;
  if (!nonce) return true;

  const pending = pendingProposals.get(nonce);
  if (!pending) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 That proposal has already passed.",
    });
    return true;
  }

  if (interaction.user.id !== pending.targetId) {
    await interaction.reply({
      ephemeral: true,
      content: "💌 These buttons are just for the person being proposed to.",
    });
    return true;
  }

  clearTimeout(pending.timeoutHandle);
  pendingProposals.delete(nonce);

  const proposerMention = `<@${pending.proposerId}>`;
  const targetMention = `<@${pending.targetId}>`;

  if (action === "decline") {
    const res = adjustRelationshipScore(pending.proposerId, pending.targetId, -15);
    const embed = new EmbedBuilder()
      .setColor(COZY_COLOR)
      .setTitle("💍 A Proposal")
      .addFields(
        {
          name: "Result",
          value: formatLine(pick(dialogue.proposeRejected), proposerMention, targetMention),
        },
        {
          name: "🌡 Relationship score",
          value: `${res.after}/100  (**${res.delta}**)`,
        }
      );
    await interaction.update({ embeds: [embed], components: [] });
    return true;
  }

  if (action === "accept") {
    const embed = new EmbedBuilder()
      .setColor(COZY_COLOR)
      .setTitle("💍 A Proposal")
      .addFields({
        name: "Result",
        value: formatLine(pick(dialogue.proposeAccepted), proposerMention, targetMention),
      })
      .setFooter({ text: "Preparing the ceremony…" });

    await interaction.update({ embeds: [embed], components: [] });
    await runCeremony({
      message: interaction.message,
      partnerAId: pending.proposerId,
      partnerBId: pending.targetId,
    });
    return true;
  }

  await interaction.reply({
    ephemeral: true,
    content: "💌 I didn’t understand that response button.",
  });
  return true;
}

const cozybotCommand = new SlashCommandBuilder()
  .setName("cozybot")
  .setDescription("Cozybot relationship commands.")
  .addSubcommand((sub) =>
    sub
      .setName("flirt")
      .setDescription("Flirt with someone.")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Who to flirt with").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("compliment")
      .setDescription("Compliment someone.")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("Who to compliment")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("insult")
      .setDescription("Insult someone.")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Who to insult").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("date")
      .setDescription("Invite someone on a date (requires score >= 30).")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Who to date").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("propose")
      .setDescription("Propose marriage (requires score >= 80).")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Who to propose to").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("divorce")
      .setDescription("Divorce someone (unilateral).")
      .addUserOption((opt) =>
        opt.setName("user").setDescription("Who to divorce").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Show relationship status (1 or 2 users).")
      .addUserOption((opt) =>
        opt
          .setName("user")
          .setDescription("User to inspect (or user 1)")
          .setRequired(true)
      )
      .addUserOption((opt) =>
        opt
          .setName("user2")
          .setDescription("Optional: second user to compare against")
          .setRequired(false)
      )
  );

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), {
    body: [cozybotCommand.toJSON()],
  });
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", async () => {
  try {
    await registerCommands();
    // eslint-disable-next-line no-console
    console.log(`Cozybot logged in as ${client.user.tag} and commands registered.`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to register commands:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    if (!interaction.customId.startsWith(CUSTOM_ID_PREFIX)) return;
    const [prefix, kind] = interaction.customId.split(":");
    if (prefix !== "cozybot" || !kind) return;

    let handled = false;
    if (kind === "flirt") handled = await handleFlirtButton(interaction);
    if (kind === "date") handled = await handleDateInviteButton(interaction);
    if (kind === "propose") handled = await handleProposeButton(interaction);
    if (handled) return;
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "cozybot") return;

  const sub = interaction.options.getSubcommand();
  if (sub === "flirt") {
    await handleFlirtCommand(interaction);
    return;
  }
  if (sub === "compliment") {
    await handleComplimentCommand(interaction);
    return;
  }
  if (sub === "insult") {
    await handleInsultCommand(interaction);
    return;
  }
  if (sub === "status") {
    await handleStatusCommand(interaction);
    return;
  }
  if (sub === "date") {
    await handleDateCommand(interaction);
    return;
  }
  if (sub === "propose") {
    await handleProposeCommand(interaction);
    return;
  }
  if (sub === "divorce") {
    await handleDivorceCommand(interaction);
    return;
  }

  await interaction.reply({
    ephemeral: true,
    content: `💌 That subcommand (\`${sub}\`) isn’t wired up yet — coming next.`,
  });
});

client.login(DISCORD_TOKEN);

