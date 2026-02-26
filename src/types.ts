export interface TrafficCamera {
  cameralabel: string;
  imageurl: {
    url: string;
  };
  video_url?: {
    url: string;
  };
  web_url?: {
    url: string;
  };
  x_coord: string;
  y_coord: string;
  location: {
    latitude: string;
    longitude: string;
  };
}
