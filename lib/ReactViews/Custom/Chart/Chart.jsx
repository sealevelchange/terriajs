'use strict';

// For documentation on the custom <chart> tag, see lib/Models/registerCustomComponentTypes.js.
//
// Two possible approaches to combining D3 and React:
// 1. Render SVG element in React, let React keep control of the DOM.
// 2. React treats the element like a blackbox, and D3 is in control.
// We take the second approach, because it gives us much more of the power of D3 (animations etc).
//
// See also:
// https://facebook.github.io/react/docs/working-with-the-browser.html
// http://ahmadchatha.com/writings/article1.html
// http://nicolashery.com/integrating-d3js-visualizations-in-a-react-app/

import React from 'react';

import PropTypes from 'prop-types';
import createReactClass from 'create-react-class';

import defined from 'terriajs-cesium/Source/Core/defined';
import defaultValue from 'terriajs-cesium/Source/Core/defaultValue';
import DeveloperError from 'terriajs-cesium/Source/Core/DeveloperError';
import loadText from '../../../Core/loadText';
import when from 'terriajs-cesium/Source/ThirdParty/when';

import ChartData from '../../../Charts/ChartData';
import LineChart from '../../../Charts/LineChart';
import proxyCatalogItemUrl from '../../../Models/proxyCatalogItemUrl';
import TableStructure from '../../../Map/TableStructure';
import VarType from '../../../Map/VarType';

import Styles from './chart.scss';

const defaultHeight = 100;
const defaultColor = undefined; // Allows the line color to be set by the css, esp. in the feature info panel.

const Chart = createReactClass({
    // this._element is updated by the ref callback attribute, https://facebook.github.io/react/docs/more-about-refs.html
    _element: undefined,

    _promise: undefined,

    _tooltipId: undefined,

    propTypes: {
        domain: PropTypes.object,
        styling: PropTypes.string,  // nothing, 'feature-info' or 'histogram' -- TODO: improve
        height: PropTypes.number,
        axisLabel: PropTypes.object,
        catalogItem: PropTypes.object,
        transitionDuration: PropTypes.number,
        highlightX: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        updateCounter: PropTypes.any,  // Change this to trigger an update.
        pollSeconds: PropTypes.any, // This is not used by Chart. It is used internally by registerCustomComponentTypes.
        // You can provide the data directly via props.data (ChartData[]):
        data: PropTypes.array,
        // Or, provide a URL to the data, along with optional xColumn, yColumns, colors
        url: PropTypes.string,
        xColumn: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
        yColumns: PropTypes.array,
        colors: PropTypes.array,
        pollUrl: PropTypes.string,
        // Or, provide a tableStructure directly.
        tableStructure: PropTypes.object
    },

    chartDataArrayFromTableStructure(table) {
        const xColumn = table.getColumnWithNameIdOrIndex(this.props.xColumn || 0);
        let yColumns = [];
        if (defined(this.props.yColumns)) {
            yColumns = this.props.yColumns.map(column => table.getColumnWithNameIdOrIndex(column));
        } else {
            // Fall back to the first scalar that isn't the x column.
            yColumns = table.columns.filter(column => (column !== xColumn) && column.type === VarType.SCALAR);
            if (yColumns.length > 0) {
                yColumns = [yColumns[0]];
            } else {
                throw new DeveloperError('No y-column available.');
            }
        }
        const pointArrays = table.toPointArrays(xColumn, yColumns);
        // The data id should be set to something unique, eg. its source id + column index.
        // If we're here, the data was downloaded from a single file or table, so the column index is unique by itself.
        const colors = this.props.colors;
        return pointArrays.map((points, index) =>
            new ChartData(points, {
                id: index,
                name: yColumns[index].name,
                units: yColumns[index].units,
                color: (colors && colors.length > 0) ? colors[index % colors.length] : defaultColor
            })
        );
    },

    getChartDataPromise(data, url, catalogItem) {
        // Returns a promise that resolves to an array of ChartData.
        const that = this;
        if (defined(data)) {
            // Nothing to do - the data was provided (either as props.data or props.tableStructure).
            return when(data);
        } else if (defined(url)) {
            return loadIntoTableStructure(catalogItem, url)
                .then(that.chartDataArrayFromTableStructure)
                .otherwise(function(e) {
                    // It looks better to create a blank chart than no chart.
                    return [];
                });
        }
    },

    componentDidMount() {
        const that = this;
        const chartParameters = that.getChartParameters();
        const promise = that.getChartDataPromise(chartParameters.data, that.props.url, that.props.catalogItem);
        promise.then(function(data) {
            chartParameters.data = data;
            LineChart.create(that._element, chartParameters);
        });
        that._promise = promise.then(function() {
            // that.rnd = Math.random();
            // React should handle the binding for you, but it doesn't seem to work here; perhaps because it is inside a Promise?
            // So we return the bound listener function from the promise.
            const resize = function() {
                // This function basically the same as componentDidUpdate, but it speeds up transitions.
                // Note same caveats - doesn't work if the data came from a URL.
                // That's ok for our purposes, since the URL is only used in a feature info panel, which never resizes dynamically.
                if (that._element) {
                    const localChartParameters = that.getChartParameters();
                    if (defined(chartParameters.data)) {
                        localChartParameters.transitionDuration = 1;
                        LineChart.update(that._element, localChartParameters);
                    }
                } else {
                    // This would happen if event listeners were not properly removed (ie. if you get this error, a bug was introduced to this code).
                    throw new DeveloperError('Missing chart DOM element ' + that.url);
                }
            };
            // console.log('Listening for resize on', that.props.url, that.rnd, boundComponentDidUpdate);
            window.addEventListener('resize', resize);
            return resize;
        });
    },

    componentDidUpdate() {
        // Update the chart with props.data or props.tableStructure, if present.
        // If the data came from a URL, there are three possibilities:
        // 1. The URL has changed.
        // 2. The URL is the same and therefore we do not want to reload it.
        // 3. The URL is the same, but the chart came from a self-updating <chart> tag (ie. one with a poll-seconds attribute),
        //    and so we do want to reload it.
        // Note that registerCustomComponent types wraps its charts in a div with a key based on the url,
        // so if the URL has changed, it actually mounts a new component, thereby triggering a load.
        // (Ie. we don't need to cover case (1) here.)
        // In case (3), props.updateCounter will be set to an integer, and we should update the data from the URL.
        const element = this._element;
        const chartParameters = this.getChartParameters();
        if (defined(chartParameters.data)) {
            LineChart.update(element, chartParameters);
        } else if (this.props.updateCounter > 0) {
            // The risk here is if it's a time-varying csv with <chart> polling as well.
            const url = this.props.pollUrl || this.props.url;
            const promise = this.getChartDataPromise(chartParameters.data, url, this.props.catalogItem);
            promise.then(function(data) {
                chartParameters.data = data;
                LineChart.update(element, chartParameters);
            });
        }
    },

    componentWillUnmount() {
        const that = this;
        this._promise.then(function(listener) {
            window.removeEventListener('resize', listener);
            // console.log('Removed resize listener for', that.props.url, that.rnd, listener);
            LineChart.destroy(that._element, that.getChartParameters());
            that._element = undefined;
        });
        this._promise = undefined;
    },

    getChartParameters() {
        // Return the parameters for LineChart.js (or other chart type).
        // If it is not a mini-chart, add tooltip settings (including a unique id for the tooltip DOM element).
        let margin;
        let tooltipSettings;
        let titleSettings;
        let grid;
        if (this.props.styling !== 'feature-info') {
            if (!defined(this._tooltipId)) {
                // In case there are multiple charts with tooltips. Unlikely to pick the same random number. Remove the initial "0.".
                this._tooltipId = 'd3-tooltip-' + Math.random().toString().substr(2);
            }
            margin = {
                top: 0,  // So the title is flush with the top of the chart panel.
                right: 20,
                bottom: 20,
                left: 0
            };
            tooltipSettings = {
                className: Styles.toolTip,
                id: this._tooltipId,
                align: 'prefer-right', // With right/left alignment, the offset is relative to the svg, so need to inset.
                offset: {top: 40, left: 66, right: 30, bottom: 5}
            };
            titleSettings = {
                type: 'legend',
                height: 30
            };
            grid = {
                x: true,
                y: true
            };
        }
        if (defined(this.props.highlightX)) {
            tooltipSettings = undefined;
        }
        if (this.props.styling === 'histogram') {
            titleSettings = undefined;
            margin = {top: 0, right: 0, bottom: 0, left: 0};
        }

        let chartData;
        if (defined(this.props.data)) {
            chartData = this.props.data;
        } else if (defined(this.props.tableStructure)) {
            chartData = this.chartDataArrayFromTableStructure(this.props.tableStructure);
        }

        return {
            data: chartData,
            domain: this.props.domain,
            width: '100%',
            height: defaultValue(this.props.height, defaultHeight),
            axisLabel: this.props.axisLabel,
            mini: this.props.styling === 'feature-info',
            transitionDuration: this.props.transitionDuration,
            margin: margin,
            tooltipSettings: tooltipSettings,
            titleSettings: titleSettings,
            grid: grid,
            highlightX: this.props.highlightX
        };
    },

    render() {
        return (
            <div className={Styles.chart} ref={element=>{this._element = element;}}></div>
        );
    }
});

/**
 * Loads data from a URL into a table structure.
 * @param  {String} url The URL.
 * @return {Promise} A promise which resolves to a table structure.
 */
function loadIntoTableStructure(catalogItem, url) {
    if (defined(catalogItem) && defined(catalogItem.loadIntoTableStructure)) {
        return catalogItem.loadIntoTableStructure(url);
    }
    // As a fallback, try to load in the data file as csv.
    const tableStructure = new TableStructure('feature info');
    url = proxyCatalogItemUrl(catalogItem, url, '0d');
    return loadText(url).then(tableStructure.loadFromCsv.bind(tableStructure));
}

module.exports = Chart;
