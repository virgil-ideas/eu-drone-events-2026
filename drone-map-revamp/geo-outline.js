'use strict';
// Simplified coastlines, borders and map labels for the EU's eastern flank.
// The video recorder and the social preview card (og/card.html) both draw them.
window.DRONE_GEO = {
  lines: [
    // Black Sea West & North Coast (Turkey -> Bulgaria -> Romania -> Ukraine -> Crimea)
    [[41.2,29.0],[41.9,28.0],[42.5,27.5],[42.7,27.7],[43.2,27.9],[43.4,28.5],[43.7,28.6],[44.2,28.65],[44.8,29.6],[45.2,29.7],[45.5,29.6],[46.0,30.4],[46.5,30.7],[46.6,31.5],[46.2,32.2],[46.0,33.5],[45.3,32.5],[44.4,33.8],[44.6,34.4],[45.3,36.5]],
    // Danube / Romania-Bulgaria-Ukraine border
    [[43.8,22.9],[43.7,24.0],[43.6,25.5],[44.0,26.5],[44.1,27.3],[44.4,28.0],[45.2,28.2],[45.4,28.2],[45.3,28.8],[45.2,29.7]],
    // Romania-Moldova-Ukraine inland
    [[45.4,28.2],[46.5,28.2],[47.2,27.6],[48.2,26.6],[47.9,25.2],[47.9,23.9]],
    // Aegean & Greece
    [[38.0,23.5],[38.4,24.1],[39.3,23.2],[40.5,22.9],[40.6,24.5],[40.9,26.0],[40.0,26.2],[39.0,26.9],[38.3,26.2],[37.0,27.4]],
    // Baltic Coast & Finland / Sweden / Poland / Germany
    [[53.9,14.2],[54.5,16.5],[54.4,18.6],[54.7,20.0],[55.3,21.0],[55.7,21.1],[56.0,21.0],[57.0,21.4],[57.8,22.6],[57.0,24.1],[57.8,24.4],[58.4,24.5],[59.4,24.7],[59.5,26.5],[59.4,28.2],[60.1,29.7],[60.5,27.8],[60.1,24.9],[60.4,22.2],[61.5,21.5],[63.8,22.7]],
    // Lithuania / Latvia / Estonia / Poland / Belarus eastern borders
    [[53.9,23.5],[54.3,25.6],[55.2,26.6],[55.7,26.6],[56.2,28.1],[57.5,27.3],[57.8,27.5],[59.4,28.2]],
    // Southern Sweden & Denmark
    [[55.4,13.0],[56.0,12.7],[57.7,11.9],[58.9,11.1],[59.3,18.1],[56.2,16.0],[55.4,13.0]]
  ],
  labels: [
    {country:'Romania', lat:45.8, lng:25.2},
    {country:'Bulgaria', lat:42.7, lng:25.5},
    {country:'Greece', lat:39.2, lng:22.2},
    {country:'Poland', lat:52.2, lng:19.4},
    {country:'Lithuania', lat:55.3, lng:23.9},
    {country:'Latvia', lat:56.9, lng:24.6},
    {country:'Estonia', lat:58.7, lng:25.5},
    {country:'Finland', lat:61.2, lng:25.8},
    {country:'Sweden', lat:56.8, lng:14.8},
    {country:'Germany', lat:52.5, lng:12.5},
    {key:'revamp.blackSea', lat:43.6, lng:31.4, sea:true},
    {key:'revamp.balticSea', lat:56.4, lng:19.2, sea:true}
  ]
};
