const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");

const {
  adjustRelationshipScore,
  getRelationshipScore,
  relationshipMeter,
  findMarriageBetween,
} = require("./relationship");
const dialogue = require("./dialogue");

const COZY_COLOR = 0xf4a7b9;

const DATE_MOVES = {
  roundPositive: { pts: [10, 18] }, // +pts
  roundNegative: { pts: [8, 16] }, // -pts
  kissYes: { pts: [14, 24] }, // +pts
  kissNo: { pts: [6, 14] }, // -pts
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function rollPts([min, max], sign = 1) {
  return randInt(min, max) * sign;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function rehydrateMessage(message) {
  if (message?.channel) return message;
  const channel = await message.client.channels.fetch(message.channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Date: channel ${message.channelId} is not text-based or missing.`);
  }
  return await channel.messages.fetch(message.id);
}

async function runDate({ message, inviterId, inviteeId }) {
  try {
    // Ensure channel/message are fetchable even when cache is cold.
    // This prevents DiscordjsError: ChannelNotCached from message.edit().
    // eslint-disable-next-line no-param-reassign
    message = await rehydrateMessage(message);

    const inviterMention = `<@${inviterId}>`;
    const inviteeMention = `<@${inviteeId}>`;
    const icon = findMarriageBetween(inviterId, inviteeId) ? "💍" : "🤍";

    const beats = [];
    let netDelta = 0;
    let positiveRounds = 0;
    let negativeRounds = 0;

    function makeEmbed() {
      return new EmbedBuilder()
        .setColor(COZY_COLOR)
        .setTitle("💐 Date Night")
        .setDescription(beats.join("\n"));
    }

    beats.push(pick(dialogue.dateOpening));
    await message.edit({ embeds: [makeEmbed()], components: [] });
    await sleep(2000);

    for (let round = 1; round <= 2; round += 1) {
      const positive = Math.random() < 0.5;
      if (positive) {
        positiveRounds += 1;
        const pts = rollPts(DATE_MOVES.roundPositive.pts, 1);
        const res = adjustRelationshipScore(inviterId, inviteeId, pts);
        netDelta += res.delta;
        beats.push(
          `**Round ${round}:** ${pick(dialogue.dateMiddle_positive)}  \`(+${pts}pts)\`  ${icon} ${relationshipMeter(res.after)}  ${res.after}/100`
        );
      } else {
        negativeRounds += 1;
        const pts = rollPts(DATE_MOVES.roundNegative.pts, -1);
        const res = adjustRelationshipScore(inviterId, inviteeId, pts);
        netDelta += res.delta;
        beats.push(
          `**Round ${round}:** ${pick(dialogue.dateMiddle_negative)}  \`(${pts}pts)\`  ${icon} ${relationshipMeter(res.after)}  ${res.after}/100`
        );
      }

      await message.edit({ embeds: [makeEmbed()], components: [] });
      await sleep(2000);
    }

    const closing =
      positiveRounds > negativeRounds
        ? pick(dialogue.dateClosing_positive)
        : positiveRounds < negativeRounds
          ? pick(dialogue.dateClosing_negative)
          : netDelta >= 0
            ? pick(dialogue.dateClosing_positive)
            : pick(dialogue.dateClosing_negative);
    beats.push(`\n${closing}`);
    await message.edit({ embeds: [makeEmbed()], components: [] });
    await sleep(2000);

    const kissRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("cozybot:datekiss:yes")
        .setLabel("Kiss")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("cozybot:datekiss:no")
        .setLabel("No Kiss")
        .setStyle(ButtonStyle.Secondary)
    );

    const kissEmbed = makeEmbed().setFooter({
      text: "Invitee has 30 seconds to decide.",
    });
    await message.edit({ embeds: [kissEmbed], components: [kissRow] });

    let kissed = false;
    let kissTimedOut = false;
    try {
      const btn = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 30_000,
        filter: (i) =>
          i.user.id === inviteeId &&
          (i.customId === "cozybot:datekiss:yes" || i.customId === "cozybot:datekiss:no"),
      });

      kissed = btn.customId === "cozybot:datekiss:yes";
      await btn.deferUpdate();
    } catch {
      kissed = false;
      kissTimedOut = true;
    }

    if (kissed) {
      const pts = rollPts(DATE_MOVES.kissYes.pts, 1);
      const res = adjustRelationshipScore(inviterId, inviteeId, pts);
      netDelta += res.delta;
      beats.push(
        `\n${pick(dialogue.dateKiss)}  \`(+${pts}pts)\`  ${icon} ${relationshipMeter(res.after)}  ${res.after}/100`
      );
    } else {
      if (kissTimedOut) {
        const totalBefore = getRelationshipScore(inviterId, inviteeId);
        beats.push(
          `\n${pick(dialogue.dateNoKiss)}  \`(+0pts)\`  ${icon} ${relationshipMeter(totalBefore)}  ${totalBefore}/100`
        );
      } else {
        const pts = rollPts(DATE_MOVES.kissNo.pts, -1);
        const res = adjustRelationshipScore(inviterId, inviteeId, pts);
        netDelta += res.delta;
        beats.push(
          `\n${pick(dialogue.dateNoKiss)}  \`(${pts}pts)\`  ${icon} ${relationshipMeter(res.after)}  ${res.after}/100`
        );
      }
    }

    const total = getRelationshipScore(inviterId, inviteeId);
    beats.push(`\n~ ${netDelta >= 0 ? `+${netDelta}` : `${netDelta}`}pts • ${total}/100 ~`);
    const finalEmbed = makeEmbed()
      .setFooter({ text: "Date complete." })
      .addFields({
        name: "Net XP",
        value: netDelta >= 0 ? `**+${netDelta}**` : `**${netDelta}**`,
        inline: true,
      })
      .addFields({
        name: "Pair",
        value: `${inviterMention} + ${inviteeMention}`,
        inline: true,
      });

    await message.edit({ embeds: [finalEmbed], components: [] });
    return { netDelta, positiveRounds, negativeRounds, total };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("runDate failed:", err);
    try {
      const embed = new EmbedBuilder()
        .setColor(0xaa4465)
        .setTitle("💌 Date Night (oops)")
        .setDescription("Something went wrong while running this date. Try again in a moment.");
      await message.edit({ embeds: [embed], components: [] });
    } catch {
      // ignore
    }
    throw err;
  }
}

module.exports = { runDate };

