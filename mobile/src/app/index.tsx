import { Redirect } from "expo-router";
import { useSession } from "../providers/session-provider";

export default function Index() {
  const { authenticated } = useSession();

  if (authenticated) {
    return <Redirect href="/home" />;
  }

  return <Redirect href="/(auth)/login" />;
}
