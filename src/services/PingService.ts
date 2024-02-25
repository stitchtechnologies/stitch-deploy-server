const pingTimes: { time: string, url: string }[] = [];

const ping = (time: string, url: string) => {
  pingTimes.push({ time, url });
  return pingTimes;
};

export default {
  ping,
} as const;
