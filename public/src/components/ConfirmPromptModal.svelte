<script>
  import { getDialogService } from "../runtime/dialogServiceContext.js";

  const dialogs = getDialogService();
  const confirmPrompt = dialogs.confirmPrompt;
</script>

{$confirmPrompt.message}
