import { Declare, Command, Options } from "seyfert";
import GrantSubcommand from "./grant";
import RevokeSubcommand from "./revoke";
import ListSubcommand from "./list";

@Declare({
  name: "access",
  description: "Manage role-based permission scopes",
  props: { access: "admin" },
})
@Options([GrantSubcommand, RevokeSubcommand, ListSubcommand])
export default class AccessCommand extends Command {}
