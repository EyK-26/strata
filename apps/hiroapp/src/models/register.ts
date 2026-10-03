// Side-effect imports run registerModelRepository() in each model file.
// registerModelClass() is only for a string alias that is neither constructor.name nor $morphClass.
import { registerModelClass } from "@getstrata/core/database/model";
import "./Note.ts";
import "./User.ts";
import "./AuthOneTimeToken.ts";
import "./ApiToken.ts";

// Example after you add a Product model with belongsTo('Category'):
// registerModelClass("Category", Category);
void registerModelClass;
