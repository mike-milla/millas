'use strict';

const chalk = require('chalk');

/**
 * Bootstrap-inspired styling system for CLI output
 * Provides consistent theming across all commands
 */
class Style {
  // Bootstrap-style variants
  success(text) {
    return chalk.green(text);
  }

  danger(text) {
    return chalk.red(text);
  }

  warning(text) {
    return chalk.yellow(text);
  }

  info(text) {
    return chalk.cyan(text);
  }

  primary(text) {
    return chalk.blue(text);
  }

  secondary(text) {
    return chalk.gray(text);
  }

  muted(text) {
    return chalk.dim(text);
  }

  light(text) {
    return chalk.white(text);
  }

  dark(text) {
    return chalk.black(text);
  }

  // Text styles
  bold(text) {
    return chalk.bold(text);
  }

  italic(text) {
    return chalk.italic(text);
  }

  underline(text) {
    return chalk.underline(text);
  }

  // HTTP method colors
  method(verb) {
    const colors = {
      GET: chalk.green,
      POST: chalk.blue,
      PUT: chalk.yellow,
      PATCH: chalk.magenta,
      DELETE: chalk.red,
    };
    return colors[verb] || chalk.white;
  }

  // Status indicators
  checkmark(text = '') {
    return chalk.green(`✔ ${text}`);
  }

  cross(text = '') {
    return chalk.red(`✖ ${text}`);
  }

  bullet(text = '') {
    return chalk.cyan(`• ${text}`);
  }

  arrow(text = '') {
    return chalk.cyan(`→ ${text}`);
  }

  // Borders and separators
  line(length = 80, char = '─') {
    return chalk.gray(char.repeat(length));
  }

  // Badges
  badge(text, variant = 'primary') {
    const styles = {
      success: chalk.bgGreen.black,
      danger: chalk.bgRed.white,
      warning: chalk.bgYellow.black,
      info: chalk.bgCyan.black,
      primary: chalk.bgBlue.white,
      secondary: chalk.bgGray.white,
    };
    const style = styles[variant] || styles.primary;
    return style(` ${text} `);
  }

  // Code/path highlighting
  code(text) {
    return chalk.cyan(text);
  }

  path(text) {
    return chalk.cyan(text);
  }

  // Key-value pairs
  kv(key, value) {
    return `${chalk.dim(key)}: ${chalk.white(value)}`;
  }
}

module.exports = Style;
