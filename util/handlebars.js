const moment = require('moment-timezone');
const { google, outlook, office365, yahoo, ics } = require("calendar-link");
const { v1LevelingSequence, v2LevelingSequence } = require('./enclave-consts');

// N times helper, usage: {{#times 5}}<div>{{index}}</div>{{/times}}
// https://stackoverflow.com/a/41463316
const times = function (n, block) {
  var accum = '';
  for (var i = 0; i < n; ++i) {
    block.data.index = i;
    block.data.first = i === 0;
    block.data.last = i === (n - 1);
    accum += block.fn(this);
  }
  return accum;
};

const date_tz = function (datetime, format, timezone) {
  if (!datetime) return '';
  if (timezone === 'local') timezone = moment.tz.guess();
  return moment.utc(datetime).tz(timezone).format(format);
}

const encodeURIComponentH = function (str) {
  return encodeURIComponent(str);
}

const calendar_link = function (platform, start, title, description) {
  const end = moment(start).add(3, 'hour').toDate();
  const eventData = {
    start,
    end,
    title,
    description
  };

  switch (platform) {
    case 'google':
      return google(eventData);
    case 'outlook':
      return outlook(eventData);
    case 'office365':
      return office365(eventData);
    case 'yahoo':
      return yahoo(eventData);
    case 'ics':
      return ics(eventData);
  }
  return false;
}

const getTotalV1MissionsNeeded = (targetLevel) => {
  if (targetLevel <= 1) return 0;
  return v1LevelingSequence.slice(0, targetLevel - 1).reduce((sum, num) => sum + num, 0);
};

const getTotalV2MissionsNeeded = (targetLevel) => {
  if (targetLevel <= 1) return 0;
  return v2LevelingSequence.slice(0, targetLevel - 1).reduce((sum, num) => sum + num, 0);
};

function setVariable(varName, varValue, options){
  options.data.root[varName] = varValue;
};

function dump(varName) {
  return JSON.stringify(varName, null, 2);
}

/**
 * Video provider configurations
 */
const videoProviders = {
  youtube: {
    name: 'YouTube',
    patterns: [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    ],
    getEmbedUrl: (id) => `https://www.youtube.com/embed/${id}`,
    detectPattern: /(?:youtube\.com|youtu\.be)/,
  },
  twitch: {
    name: 'Twitch',
    patterns: [
      // Twitch VODs: twitch.tv/videos/123456789
      /twitch\.tv\/videos\/(\d+)/,
    ],
    getEmbedUrl: (id) => `https://player.twitch.tv/?video=${id}&parent=${process.env.HOSTNAME || 'localhost'}`,
    detectPattern: /twitch\.tv\/videos/,
  },
  twitchClip: {
    name: 'Twitch Clip',
    patterns: [
      // Twitch clips: clips.twitch.tv/ClipSlug or twitch.tv/channel/clip/ClipSlug
      /clips\.twitch\.tv\/([a-zA-Z0-9_-]+)/,
      /twitch\.tv\/\w+\/clip\/([a-zA-Z0-9_-]+)/,
    ],
    getEmbedUrl: (id) => `https://clips.twitch.tv/embed?clip=${id}&parent=${process.env.HOSTNAME || 'localhost'}`,
    detectPattern: /(?:clips\.twitch\.tv|twitch\.tv\/\w+\/clip)/,
  },
};

/**
 * Detects the video provider from a URL
 * Returns: 'youtube', 'twitch', 'twitchClip', or null
 */
function getVideoProvider(url) {
  if (!url) return null;
  
  for (const [key, provider] of Object.entries(videoProviders)) {
    if (provider.detectPattern.test(url)) {
      return key;
    }
  }
  return null;
}

/**
 * Converts a video URL to an embeddable URL
 * Supports YouTube, Twitch VODs, and Twitch Clips
 */
function videoEmbed(url) {
  if (!url) return null;
  
  for (const provider of Object.values(videoProviders)) {
    for (const pattern of provider.patterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return provider.getEmbedUrl(match[1]);
      }
    }
  }
  
  return null;
}

/**
 * Checks if a URL is a supported video URL
 */
function isSupportedVideoUrl(url) {
  return getVideoProvider(url) !== null;
}

/**
 * Legacy helper - converts a YouTube URL to an embeddable URL
 */
function youtubeEmbed(url) {
  if (!url || !videoProviders.youtube.detectPattern.test(url)) return null;
  return videoEmbed(url);
}

/**
 * Legacy helper - checks if a URL is a YouTube URL
 */
function isYoutubeUrl(url) {
  if (!url) return false;
  return videoProviders.youtube.detectPattern.test(url);
}

module.exports = {
  times,
  date_tz,
  calendar_link,
  encodeURIComponentH,
  getTotalV1MissionsNeeded,
  getTotalV2MissionsNeeded,
  setVariable,
  dump,
  youtubeEmbed,
  isYoutubeUrl,
  videoEmbed,
  isSupportedVideoUrl,
  getVideoProvider
}
