const {
    Validator,
    BaseValidator,
    StringValidator,
    EmailValidator,
    NumberValidator,
    BooleanValidator,
    DateValidator,
    ArrayValidator,
    ObjectValidator,
    FileValidator,
    string,
    email,
    number,
    boolean,
    date,
    array,
    objectField,
    fileField
} = require("../validation/Validator");
module.exports = {
    Validator,
    BaseValidator,
    StringValidator, EmailValidator, NumberValidator, BooleanValidator,
    DateValidator, ArrayValidator, ObjectValidator, FileValidator,
    string, email, number, boolean, date, array,
    object: objectField,
    file: fileField,
}