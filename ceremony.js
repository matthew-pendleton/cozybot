const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  Routes,
} = require("discord.js");

const {
  addMarriage,
  adjustRelationshipScore,
  relationshipMeter,
  findMarriageBetween,
} = require("./relationship");
const dialogue = require("./dialogue");

const COZY_COLOR = 0xf4a7b9;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mention(id) {
  return `<@${id}>`;
}

function formatDelta(delta) {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return "0";
}

function meterLine(score, icon) {
  return `\`${icon} ${relationshipMeter(score)}  ${score}/100\``;
}

async function editInteractionMessage(client, webhookId, webhookToken, messageId, payload) {
  await client.rest.patch(Routes.webhookMessage(webhookId, webhookToken, messageId), {
    body: payload,
  });
}

function waitForRoleClick({ client, messageId, partnerAId, partnerBId, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      client.off("interactionCreate", onInteraction);
    }

    async function onInteraction(i) {
      try {
        if (!i.isButton()) return;
        if (i.message?.id !== messageId) return;
        if (!i.customId.startsWith("cozybot:ceremony:role:")) return;
        if (i.user.id === partnerAId || i.user.id === partnerBId) {
          await i.reply({
            ephemeral: true,
            content: "💌 The couple can’t claim ceremony roles. Nice try, though.",
          });
          return;
        }
        cleanup();
        resolve(i);
      } catch (err) {
        cleanup();
        reject(err);
      }
    }

    client.on("interactionCreate", onInteraction);
  });
}

async function runCeremony({ message, channel, webhookId, webhookToken, partnerAId, partnerBId }) {
  const client = message.client;
  const messageId = message.id;
  const canUseWebhook = Boolean(webhookId && webhookToken);
  const doEdit = canUseWebhook
    ? (payload) => editInteractionMessage(client, webhookId, webhookToken, messageId, payload)
    : (payload) => message.edit(payload);

  const state = {
    officiantId: null,
    flowerGirlId: null,
  };

  const lobbyEmbed = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("💒 Wedding Ceremony Lobby")
    .setDescription(
      [
        `${mention(partnerAId)} + ${mention(partnerBId)} are getting married!`,
        "",
        "Pick a role to help with the ceremony:",
        "- 📖 Officiant (1 slot)",
        "- 💐 Flower Girl (1 slot)",
      ].join("\n")
    )
    .setFooter({ text: "Roles lock in after 60 seconds." });

  const roleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("cozybot:ceremony:role:officiant")
      .setEmoji("📖")
      .setLabel("Officiant")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("cozybot:ceremony:role:flower")
      .setEmoji("💐")
      .setLabel("Flower Girl")
      .setStyle(ButtonStyle.Secondary)
  );

  await doEdit({ embeds: [lobbyEmbed.toJSON()], components: [roleRow.toJSON()] });

  const endAt = Date.now() + 60_000;
  while (Date.now() < endAt) {
    const remaining = Math.max(1, endAt - Date.now());
    if (state.officiantId && state.flowerGirlId) break;

    try {
      // eslint-disable-next-line no-await-in-loop
      const btn = await waitForRoleClick({
        client,
        messageId,
        partnerAId,
        partnerBId,
        timeoutMs: remaining,
      });

      const role = btn.customId.split(":").at(-1);
      if (role === "officiant") {
        if (state.officiantId) {
          // eslint-disable-next-line no-await-in-loop
          await btn.reply({ ephemeral: true, content: "💌 That officiant role is already taken." });
          continue;
        }
        state.officiantId = btn.user.id;
        // eslint-disable-next-line no-await-in-loop
        await btn.reply({ ephemeral: true, content: "💌 You’re the officiant!" });
      } else if (role === "flower") {
        if (state.flowerGirlId) {
          // eslint-disable-next-line no-await-in-loop
          await btn.reply({ ephemeral: true, content: "💌 That flower girl role is already taken." });
          continue;
        }
        state.flowerGirlId = btn.user.id;
        // eslint-disable-next-line no-await-in-loop
        await btn.reply({ ephemeral: true, content: "💌 You’re the flower girl!" });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await btn.reply({ ephemeral: true, content: "💌 Unknown role." });
      }
    } catch {
      break;
    }
  }

  const officiantName = state.officiantId ? mention(state.officiantId) : "a mysterious stranger";
  const flowerName = state.flowerGirlId ? mention(state.flowerGirlId) : "a mysterious stranger";

  const lines = [];
  function embed() {
    return new EmbedBuilder()
      .setColor(COZY_COLOR)
      .setTitle("💒 Wedding Ceremony")
      .setDescription(lines.join("\n"));
  }

  lines.push(`${mention(partnerAId)} + ${mention(partnerBId)}`);
  lines.push("");
  lines.push(...dialogue.ceremonyOpening);
  await doEdit({ embeds: [embed().toJSON()], components: [] });
  await sleep(2000);

  lines.push("");
  lines.push(`> 📖 **${officiantName}:** ${pick(dialogue.ceremonyOfficiantLines)}`);
  await doEdit({ embeds: [embed().toJSON()], components: [] });
  await sleep(2000);

  lines.push(`> 📖 **${officiantName}:** ${pick(dialogue.ceremonyOfficiantLines)}`);
  await doEdit({ embeds: [embed().toJSON()], components: [] });
  await sleep(2000);

  lines.push("");
  lines.push(`> 💐 **${flowerName}:** ${pick(dialogue.ceremonyFlowerGirlMoments)}`);
  await doEdit({ embeds: [embed().toJSON()], components: [] });
  await sleep(2000);

  lines.push("");
  lines.push(`**${mention(partnerAId)}’s vows:** ${pick(dialogue.ceremonyVows)}`);
  await doEdit({ embeds: [embed().toJSON()], components: [] });
  await sleep(2000);

  lines.push(`**${mention(partnerBId)}’s vows:** ${pick(dialogue.ceremonyVows)}`);
  await doEdit({ embeds: [embed().toJSON()], components: [] });
  await sleep(2000);

  lines.push("");
  lines.push(pick(dialogue.ceremonyClosing));
  await doEdit({ embeds: [embed().toJSON()], components: [] });
  await sleep(1500);

  addMarriage(partnerAId, partnerBId);
  const res = adjustRelationshipScore(partnerAId, partnerBId, 15);
  const icon = findMarriageBetween(partnerAId, partnerBId) ? "💍" : "🤍";

  const final = new EmbedBuilder()
    .setColor(COZY_COLOR)
    .setTitle("💍 Congratulations!")
    .setDescription(
      [
        `${mention(partnerAId)} and ${mention(partnerBId)} are now married.`,
        "",
        `\`${formatDelta(res.delta)}pts\``,
        meterLine(res.after, icon),
      ].join("\n")
    )
    .setFooter({ text: "May your days be soft and your snacks plentiful." });

  await doEdit({ embeds: [final.toJSON()], components: [] });
}

module.exports = { runCeremony };

