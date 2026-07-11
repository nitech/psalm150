import "./styles.css";
import "./components/app";
import { checkForUpdates } from "./updater";

if (import.meta.env.PROD) {
  void checkForUpdates();
}
