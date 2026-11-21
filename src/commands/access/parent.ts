import { Declare, Command, Options } from "seyfert";
import GrantSubcommand from "./grant";
import RevokeSubcommand from "./revoke";
import ListSubcommand from "./list";
import HelpSubcommand from "./help";

@Declare({
  name: "access",
  description: "Manage role permissions for bot features and commands",
  props: { access: "admin" },
})
@Options([GrantSubcommand, RevokeSubcommand, ListSubcommand, HelpSubcommand])
export default class AccessCommand extends Command {}
