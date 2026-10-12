export type AspectRatio = {
  id: string;
  name: string;
  width: number;
  height: number;
};

export const aspectRatios: AspectRatio[] = [
  {
    id: "1",
    name: "16:9 - 1920x1080px",
    width: 1920,
    height: 1080,
  },
  {
    id: "2",
    name: "4:3 - 1920x1440px",
    width: 1920,
    height: 1440,
  },
  {
    id: "3",
    name: "1:1 - 1080x1080px",
    width: 1080,
    height: 1080,
  },
  {
    id: "4",
    name: "3:4 - 1080x1440px",
    width: 1080,
    height: 1440,
  },
  {
    id: "5",
    name: "9:16 - 1080x1920px",
    width: 1080,
    height: 1920,
  },
  {
    id: "6",
    name: "4:5 - 1080x1350px",
    width: 1080,
    height: 1350,
  },
  {
    id: "7",
    name: "2:3 - 1080x1620px",
    width: 1080,
    height: 1620,
  },
];
