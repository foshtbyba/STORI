function dtime_nums(offset, showYear) {
  var months = [
    'հունվարի',
    'փետրվարի',
    'մարտի',
    'ապրիլի',
    'մայիսի',
    'հունիսի',
    'հուլիսի',
    'օգոստոսի',
    'սեպտեմբերի',
    'հոկտեմբերի',
    'նոյեմբերի',
    'դեկտեմբերի'
  ];
  var d = new Date();
  d.setDate(d.getDate() + offset);
  var day = d.getDate();
  var month = months[d.getMonth()];
  if (showYear) {
    document.write(day + ' ' + month + ', ' + d.getFullYear() + ' թ.');
  } else {
    document.write(day + ' ' + month);
  }
}
