import axios from "axios";
import "./app.css";
import "./HiroApp.jsx";

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

axios.defaults.withCredentials = true;
axios.defaults.headers.common["X-Requested-With"] = "XMLHttpRequest";
axios.interceptors.request.use((config) => {
  const token = readCookie("hiroapp_csrf");
  if (token) {
    config.headers["x-csrf-token"] = token;
  }
  return config;
});
