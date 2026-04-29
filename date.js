const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");

const { adjustRelationshipScore } = require("./relationship");
const dialogue = require("./dialogue");

const COZY_COLOR = 0xf4a7b9;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runDate({ message, inviterId, inviteeId }) {
  const inviterMention = `<@${inviterId}>`;
  const inviteeMention = `<@${inviteeId}>`;

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

  for (let round = 1; round <= 3; round += 1) {
    const positive = Math.random() < 0.5;
    if (positive) {
      positiveRounds += 1;
      beats.push(`**Round ${round}:** ${pick(dialogue.dateMiddle_positive)}`);
      const res = adjustRelationshipScore(inviterId, inviteeId, 8);
      netDelta += res.delta;
    } else {
      negativeRounds += 1;
      beats.push(`**Round ${round}:** ${pick(dialogue.dateMiddle_negative)}`);
      const res = adjustRelationshipScore(inviterId, inviteeId, -6);
      netDelta += res.delta;
    }

    await message.edit({ embeds: [makeEmbed()], components: [] });
    await sleep(2000);
  }

  const closing =
    positiveRounds >= 2 ? pick(dialogue.dateClosing_positive) : pick(dialogue.dateClosing_negative);
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
  }

  if (kissed) {
    beats.push(`\n${pick(dialogue.dateKiss)}`);
    const res = adjustRelationshipScore(inviterId, inviteeId, 10);
    netDelta += res.delta;
  } else {
    beats.push(`\n${pick(dialogue.dateNoKiss)}`);
  }

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
  return { netDelta, positiveRounds, negativeRounds };
}

module.exports = { runDate };

