const {
    Model,
    fields
} = require("../orm");
const { migrations } = require("../orm/migration/operations");

module.exports = {
    Model, fields,migrations
}